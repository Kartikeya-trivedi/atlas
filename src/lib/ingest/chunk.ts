import type { DocKind, Page } from "./extract";

/**
 * Type-aware chunking.
 *
 * Fixed-size character windows cut mid-sentence, mid-table and mid-function, and
 * a chunk that begins halfway through a clause embeds badly. So the strategy
 * depends on what the document is:
 *
 *   prose         headings → paragraphs → sentences
 *   code          file → symbol (class/function), never splitting a signature
 *                 away from its body unless the body alone exceeds a chunk
 *   conversation  channel → thread → contiguous runs of messages
 *
 * Every chunk carries a breadcrumb — the path from the document root down to
 * it. Stored separately from the content so citation snippets stay clean, but
 * folded into both the embedded text and the tsvector, because "the limit is
 * 100 per request" is unretrievable without knowing what it is the limit of.
 * That heading path is this system's cheap version of contextual retrieval: it
 * recovers most of the benefit of an LLM-generated per-chunk summary at zero
 * marginal cost, which matters when the corpus is a million chunks.
 */

/** Bump when a change here should re-chunk previously ingested documents. */
export const CHUNKER_VERSION = 1;

const TARGET_CHARS = 1_400;
const MAX_CHARS = 1_900;
/** A trailing fragment shorter than this is folded back into its predecessor. */
const MIN_CHARS = 220;
const OVERLAP_RATIO = 0.12;

export interface Chunk {
  ordinal: number;
  page: number | null;
  /** "Title › Section › Subsection", or "path.py › class X › def y". */
  heading: string | null;
  content: string;
  /** Breadcrumb + content — exactly what gets embedded. */
  contextText: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface ChunkInput {
  kind: DocKind;
  title: string;
  pages: Page[];
  lang?: string;
  /** Repo-relative path or URL, used as the root of a code breadcrumb. */
  path?: string;
}

/** ~4 characters per token holds well enough for English prose to size batches. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * "Title › Section › Subsection", with consecutive repeats collapsed. A
 * markdown file whose H1 restates its filename is the common case, and
 * "Notes › Notes › Fusion" both wastes embedding budget and reads as a bug.
 */
function breadcrumb(root: string, path: readonly string[]): string {
  const parts: string[] = [];
  for (const segment of [root, ...path]) {
    const clean = segment.trim();
    if (!clean) continue;
    if (parts.at(-1)?.toLowerCase() === clean.toLowerCase()) continue;
    parts.push(clean);
  }
  return parts.join(" › ");
}

function makeChunk(
  ordinal: number,
  heading: string | null,
  content: string,
  page: number | null,
  metadata: Record<string, unknown> = {},
): Chunk {
  const contextText = heading ? `${heading}\n\n${content}` : content;
  return {
    ordinal,
    page,
    heading,
    content,
    contextText,
    tokenCount: estimateTokens(contextText),
    metadata,
  };
}

/* ─────────────────────────────────────────────────────────────────── prose ── */

const ATX = /^(#{1,6})\s+(.+?)\s*#*$/;
/** "3.2 Fusion" / "IV. Results" — common in exported PDFs that lost their markup. */
const NUMBERED = /^((?:\d+\.){1,3}\d*|[IVX]+\.)\s+(\S.{0,78})$/;

interface Block {
  text: string;
  page: number | null;
  headingLevel: number | null;
}

function toBlocks(pages: Page[]): Block[] {
  const blocks: Block[] = [];

  for (const { page, text } of pages) {
    for (const raw of text.split(/\n{2,}/)) {
      const block = raw.trim();
      if (!block) continue;

      // A heading is its own block; anything glued to it after a single newline
      // stays with the body.
      const lines = block.split("\n");
      const first = (lines[0] ?? "").trim();
      const atx = ATX.exec(first);
      const numbered = !atx && lines.length === 1 ? NUMBERED.exec(first) : null;

      if (atx) {
        blocks.push({ text: atx[2] ?? "", page, headingLevel: atx[1]?.length ?? 1 });
        const rest = lines.slice(1).join("\n").trim();
        if (rest) blocks.push({ text: rest, page, headingLevel: null });
      } else if (numbered) {
        // Depth from the number of dotted components: "3.2" is a subsection.
        const depth = Math.min(4, (numbered[1]?.match(/\./g)?.length ?? 1) + 1);
        blocks.push({ text: first, page, headingLevel: depth });
      } else {
        blocks.push({ text: block, page, headingLevel: null });
      }
    }
  }

  return blocks;
}

/** Sentence-ish split that does not fire on "e.g." or "v1.2". */
function sentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z(“"'\d])/);
  return parts.length ? parts : [text];
}

/** Hard-splits one oversized block, preferring sentence boundaries. */
function splitOversized(text: string): string[] {
  const out: string[] = [];
  let buf = "";

  for (const sentence of sentences(text)) {
    if (sentence.length > MAX_CHARS) {
      // A single sentence longer than a chunk — a table row or a minified blob.
      // Nothing structural left to respect; cut on width.
      if (buf) {
        out.push(buf.trim());
        buf = "";
      }
      for (let i = 0; i < sentence.length; i += TARGET_CHARS) {
        out.push(sentence.slice(i, i + TARGET_CHARS).trim());
      }
      continue;
    }
    if (buf.length + sentence.length + 1 > TARGET_CHARS && buf) {
      out.push(buf.trim());
      buf = "";
    }
    buf += (buf ? " " : "") + sentence;
  }

  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

/** Tail of a chunk, cut back to a sentence boundary, used to seed the next one. */
function overlapTail(text: string): string {
  const want = Math.round(TARGET_CHARS * OVERLAP_RATIO);
  if (text.length <= want) return text;

  const tail = text.slice(-want * 2);
  const sents = sentences(tail);
  let out = "";
  for (let i = sents.length - 1; i >= 0 && out.length < want; i--) {
    out = (sents[i] ?? "") + (out ? ` ${out}` : "");
  }
  return out.trim();
}

function chunkProse(input: ChunkInput): Chunk[] {
  const blocks = toBlocks(input.pages);
  const chunks: Chunk[] = [];

  let headingPath: string[] = [];
  let buf = "";
  let bufPage: number | null = null;
  let bufPath: string[] = [];

  const flush = () => {
    const content = buf.trim();
    if (!content) {
      buf = "";
      return;
    }

    const previous = chunks[chunks.length - 1];

    // The overlap carried into a buffer is a copy of the previous chunk's tail.
    // If nothing new landed on top of it before the next flush — which happens
    // whenever a section ends right after a split — emitting it would store the
    // same sentences twice and hand the model two identical passages.
    if (previous && previous.content.endsWith(content)) {
      buf = "";
      return;
    }

    const heading = breadcrumb(input.title, bufPath);

    // Fold a runt back into its predecessor, but only when they share a section
    // — otherwise the breadcrumb on the merged chunk would be a lie.
    if (
      previous &&
      content.length < MIN_CHARS &&
      previous.heading === heading &&
      previous.content.length + content.length <= MAX_CHARS
    ) {
      previous.content = `${previous.content}\n\n${content}`;
      previous.contextText = `${heading}\n\n${previous.content}`;
      previous.tokenCount = estimateTokens(previous.contextText);
      buf = "";
      return;
    }

    chunks.push(makeChunk(chunks.length, heading, content, bufPage));
    buf = "";
  };

  for (const block of blocks) {
    if (block.headingLevel !== null) {
      flush(); // a heading closes the section before it
      headingPath = headingPath.slice(0, block.headingLevel - 1);
      headingPath[block.headingLevel - 1] = block.text;
      headingPath = headingPath.filter(Boolean);
      bufPath = [...headingPath];
      bufPage = block.page;
      continue;
    }

    // A PDF page break also closes the chunk, so no chunk spans two pages and
    // every citation resolves to exactly one page number.
    if (buf && bufPage !== null && block.page !== bufPage) flush();

    if (buf === "") {
      bufPage = block.page;
      bufPath = [...headingPath];
    }

    const pieces =
      block.text.length > MAX_CHARS ? splitOversized(block.text) : [block.text];

    for (const piece of pieces) {
      if (buf && buf.length + piece.length + 2 > TARGET_CHARS) {
        const carry = overlapTail(buf);
        flush();
        bufPage = block.page;
        bufPath = [...headingPath];
        buf = carry;
      }
      buf += (buf ? "\n\n" : "") + piece;

      if (buf.length >= MAX_CHARS) {
        const carry = overlapTail(buf);
        flush();
        bufPage = block.page;
        bufPath = [...headingPath];
        buf = carry;
      }
    }
  }

  flush();
  return chunks.map((c, i) => ({ ...c, ordinal: i })); // runt-folding leaves gaps
}

/* ──────────────────────────────────────────────────────────────────── code ── */

/**
 * Symbol boundaries by language family.
 *
 * Deliberately a regex over line starts rather than a parser: a real AST needs a
 * grammar per language and breaks on the half-written files that show up in any
 * repository, whereas a missed boundary here only means a slightly larger chunk.
 * Indentation carries the nesting, which is what the breadcrumb needs.
 */
const DEFAULT_SYMBOL =
  /^(\s*)(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|static\s+|abstract\s+|final\s+)*(?:async\s+)?(?:function|class|interface|type|enum|struct|const|let|var|def|fn|func)\s+([A-Za-z_$][\w$]*)/;

const SYMBOL_PATTERNS: Record<string, RegExp> = {
  python: /^(\s*)(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)/,
  ruby: /^(\s*)(?:def|class|module)\s+([A-Za-z_][\w:.]*)/,
  go: /^(\s*)func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)|^(\s*)type\s+([A-Za-z_][\w]*)/,
  rust: /^(\s*)(?:pub\s+)?(?:async\s+)?(?:fn|struct|enum|trait|impl)\s+([A-Za-z_][\w<>]*)/,
  sql: /^(\s*)(?:create|alter)\s+(?:or\s+replace\s+)?(?:table|view|function|procedure|index|type)\s+(?:if\s+not\s+exists\s+)?([\w."]+)/i,
};

function symbolPattern(lang?: string): RegExp {
  return (lang ? SYMBOL_PATTERNS[lang] : undefined) ?? DEFAULT_SYMBOL;
}

interface SymbolSpan {
  name: string;
  indent: number;
  start: number;
  end: number;
}

function findSymbols(lines: string[], lang?: string): SymbolSpan[] {
  const pattern = symbolPattern(lang);
  const found: SymbolSpan[] = [];

  lines.forEach((line, i) => {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) return;
    const m = pattern.exec(line);
    if (!m) return;
    // The alternation in the Go pattern shifts the capture groups, so take the
    // first group that matched as the indent and the next one as the name.
    const groups = m.slice(1).filter((g): g is string => g !== undefined);
    const indent = (groups[0] ?? "").length;
    const name = groups[1] ?? "";
    if (!name) return;
    found.push({ name, indent, start: i, end: lines.length });
  });

  // A symbol runs until the next one at the same or shallower indentation.
  for (let i = 0; i < found.length; i++) {
    const current = found[i]!;
    for (let j = i + 1; j < found.length; j++) {
      const next = found[j]!;
      if (next.indent <= current.indent) {
        current.end = next.start;
        break;
      }
    }
  }

  return found;
}

function chunkCode(input: ChunkInput): Chunk[] {
  const lines = input.pages.map((p) => p.text).join("\n").split("\n");
  const root = input.path ?? input.title;
  const symbols = findSymbols(lines, input.lang);
  const chunks: Chunk[] = [];

  const push = (heading: string, body: string, firstLine: number) => {
    const content = body.replace(/^\n+|\n+$/g, "");
    if (!content.trim()) return;

    const pieces =
      content.length > MAX_CHARS
        ? // Split an oversized function on blank lines rather than sentences —
          // statement groups are the only structure left inside a body.
          content.split(/\n{2,}/).reduce<string[]>((acc, para) => {
            const last = acc[acc.length - 1];
            if (last !== undefined && last.length + para.length + 2 <= TARGET_CHARS) {
              acc[acc.length - 1] = `${last}\n\n${para}`;
            } else {
              acc.push(para);
            }
            return acc;
          }, [])
        : [content];

    const symbol = heading.split(" › ").slice(1).join(" › ");
    pieces.forEach((piece, i) => {
      chunks.push(
        makeChunk(chunks.length, heading, piece, null, {
          startLine: firstLine + 1,
          ...(pieces.length > 1 ? { part: i + 1 } : {}),
          ...(symbol ? { symbol } : {}),
        }),
      );
    });
  };

  if (symbols.length === 0) {
    // A config file, a script with no declarations, or a language the pattern
    // does not recognise. Fall back to fixed windows over the whole file.
    for (let i = 0; i < lines.length; ) {
      const start = i;
      let size = 0;
      while (i < lines.length && size < TARGET_CHARS) {
        size += (lines[i]?.length ?? 0) + 1;
        i++;
      }
      push(breadcrumb(root, []), lines.slice(start, i).join("\n"), start);
    }
    return chunks.map((c, idx) => ({ ...c, ordinal: idx }));
  }

  const baseIndent = symbols[0]!.indent;
  const topLevel = symbols.filter((s) => s.indent === baseIndent);

  // Anything before the first symbol — imports, a module docstring, a licence
  // header. Retrievable on its own because "what does this file import" is a
  // real question.
  const preamble = lines.slice(0, topLevel[0]!.start).join("\n");
  if (preamble.trim().length > MIN_CHARS) {
    push(breadcrumb(root, ["imports"]), preamble, 0);
  }

  for (const sym of topLevel) {
    const body = lines.slice(sym.start, sym.end).join("\n");
    const nested = symbols.filter(
      (s) => s.indent > sym.indent && s.start > sym.start && s.start < sym.end,
    );

    if (body.length <= MAX_CHARS || nested.length === 0) {
      push(breadcrumb(root, [sym.name]), body, sym.start);
      continue;
    }

    // A large class: emit each method as its own chunk, breadcrumbed under it,
    // so a question about one method does not drag in the whole class.
    let cursor = sym.start;
    for (const child of nested) {
      if (child.start > cursor) {
        const between = lines.slice(cursor, child.start).join("\n");
        if (between.trim().length > MIN_CHARS) {
          push(breadcrumb(root, [sym.name]), between, cursor);
        }
      }
      const childEnd = Math.min(child.end, sym.end);
      push(
        breadcrumb(root, [sym.name, child.name]),
        lines.slice(child.start, childEnd).join("\n"),
        child.start,
      );
      cursor = childEnd;
    }
    if (cursor < sym.end) {
      push(breadcrumb(root, [sym.name]), lines.slice(cursor, sym.end).join("\n"), cursor);
    }
  }

  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}

/* ────────────────────────────────────────────────────────── conversation ── */

/**
 * Conversation transcripts arrive as one page per thread, the first line being
 * a "# thread title" marker and each message on its own line. A thread is the
 * unit of meaning — a reply is unintelligible without the message it answers —
 * so threads stay whole up to the size limit and only then split on message
 * boundaries, never mid-message.
 */
function chunkConversation(input: ChunkInput): Chunk[] {
  const chunks: Chunk[] = [];

  for (const page of input.pages) {
    const lines = page.text.split("\n");
    const first = lines[0] ?? "";
    const hasTitle = first.startsWith("#");
    const thread = hasTitle ? first.replace(/^#+\s*/, "").trim() : "";
    const messages = (hasTitle ? lines.slice(1) : lines).filter((l) => l.trim());
    const heading = breadcrumb(input.title, thread ? [thread] : []);

    let buf: string[] = [];
    let size = 0;

    const flush = () => {
      if (buf.length === 0) return;
      chunks.push(
        makeChunk(chunks.length, heading, buf.join("\n"), page.page, {
          messageCount: buf.length,
          ...(thread ? { thread } : {}),
        }),
      );
      buf = [];
      size = 0;
    };

    for (const message of messages) {
      if (size > 0 && size + message.length > TARGET_CHARS) flush();
      buf.push(message);
      size += message.length + 1;
    }
    flush();
  }

  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}

/* ──────────────────────────────────────────────────────────────── dispatch ── */

export function chunk(input: ChunkInput): Chunk[] {
  switch (input.kind) {
    case "code":
      return chunkCode(input);
    case "conversation":
      return chunkConversation(input);
    default:
      return chunkProse(input);
  }
}
