import type { PageText } from "./extract";

/**
 * Structure-first chunking.
 *
 * Fixed-size character windows cut mid-sentence and mid-table, and a chunk that
 * begins halfway through a clause embeds badly. So: split on headings, then on
 * paragraphs, and only fall back to a hard character limit when a single block
 * is larger than one chunk on its own.
 *
 * Every chunk carries a breadcrumb — document title plus the heading path above
 * it. Stored separately from the content so citation snippets stay clean, but
 * folded into both the embedded text and the tsvector, because "the limit is
 * 100 per request" is unretrievable without knowing what it is the limit of.
 */

const TARGET_CHARS = 1_400;
const MAX_CHARS = 1_900;
/** A trailing fragment shorter than this is folded back into its predecessor. */
const MIN_CHARS = 220;
const OVERLAP_RATIO = 0.12;

export interface Chunk {
  ordinal: number;
  page: number | null;
  /** Breadcrumb: "Title › Section › Subsection". Null at the document root. */
  heading: string | null;
  content: string;
  tokenCount: number;
  /** Breadcrumb + content — what actually gets embedded. */
  embedText: string;
}

/** ~4 characters per token holds well enough for English prose to size batches. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

const ATX = /^(#{1,6})\s+(.+?)\s*#*$/;
/** "3.2 Fusion" / "IV. Results" — common in exported PDFs that lost their markup. */
const NUMBERED = /^((?:\d+\.){1,3}\d*|[IVX]+\.)\s+(\S.{0,78})$/;

interface Block {
  text: string;
  page: number | null;
  headingLevel: number | null;
}

function toBlocks(pages: PageText[]): Block[] {
  const blocks: Block[] = [];

  for (const { page, text } of pages) {
    for (const raw of text.split(/\n{2,}/)) {
      const block = raw.trim();
      if (!block) continue;

      // A heading is its own block; anything glued to it after a single newline
      // stays with the body.
      const lines = block.split("\n");
      const first = lines[0].trim();
      const atx = ATX.exec(first);
      const numbered = !atx && lines.length === 1 ? NUMBERED.exec(first) : null;

      if (atx) {
        blocks.push({ text: atx[2], page, headingLevel: atx[1].length });
        const rest = lines.slice(1).join("\n").trim();
        if (rest) blocks.push({ text: rest, page, headingLevel: null });
      } else if (numbered) {
        // Depth from the number of dotted components: "3.2" is a subsection.
        const depth = Math.min(4, (numbered[1].match(/\./g)?.length ?? 1) + 1);
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
      // A single sentence longer than a chunk — a table row or a minified
      // blob. Nothing structural left to respect; cut on width.
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
    out = sents[i] + (out ? ` ${out}` : "");
  }
  return out.trim();
}

/**
 * "Title › Section › Subsection", with consecutive repeats collapsed. A
 * markdown file whose H1 restates its filename is the common case, and
 * "Notes › Notes › Fusion" both wastes embedding budget and reads as a bug.
 */
function breadcrumb(title: string, path: string[]): string {
  const parts: string[] = [];
  for (const segment of [title, ...path]) {
    const clean = segment.trim();
    if (!clean) continue;
    if (parts.at(-1)?.toLowerCase() === clean.toLowerCase()) continue;
    parts.push(clean);
  }
  return parts.join(" › ");
}

export function chunkDocument(title: string, pages: PageText[]): Chunk[] {
  const blocks = toBlocks(pages);
  const chunks: Chunk[] = [];

  // headingPath[level - 1] is the current heading at that level.
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

    // Fold a runt back into its predecessor, but only when they share a
    // section — otherwise the breadcrumb on the merged chunk would be a lie.
    if (
      previous &&
      content.length < MIN_CHARS &&
      previous.heading === (bufPath.length ? breadcrumb(title, bufPath) : title) &&
      previous.content.length + content.length <= MAX_CHARS
    ) {
      previous.content = `${previous.content}\n\n${content}`;
      previous.tokenCount = estimateTokens(previous.content);
      previous.embedText = `${previous.heading}\n\n${previous.content}`;
      buf = "";
      return;
    }

    const heading = bufPath.length ? breadcrumb(title, bufPath) : title;
    chunks.push({
      ordinal: chunks.length,
      page: bufPage,
      heading,
      content,
      tokenCount: estimateTokens(content),
      embedText: `${heading}\n\n${content}`,
    });
    buf = "";
  };

  for (const block of blocks) {
    if (block.headingLevel !== null) {
      // A heading closes the section before it.
      flush();
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

    for (const piece of block.text.length > MAX_CHARS
      ? splitOversized(block.text)
      : [block.text]) {
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

  // Re-number: the runt-folding above can leave gaps.
  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}
