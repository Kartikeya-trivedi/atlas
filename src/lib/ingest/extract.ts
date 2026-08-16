/**
 * Parsing: bytes or text in, normalised pages out.
 *
 * Everything downstream works on `Page[]`, so a connector only has to say what
 * kind of thing it fetched. Page numbers are meaningful for PDFs and null for
 * everything else, which is what lets a citation resolve to "p.14" only when
 * that is a real claim.
 */

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export type DocKind =
  | "pdf"
  | "docx"
  | "md"
  | "html"
  | "txt"
  | "code"
  | "conversation";

export interface Page {
  page: number | null;
  text: string;
}

export interface Extraction {
  pages: Page[];
  /** Detected language for code, so the chunker can pick a symbol grammar. */
  lang?: string;
  parserVersion: number;
}

/** Bump when a parser change should invalidate previously ingested documents. */
export const PARSER_VERSION = 1;

const EXT_TO_KIND: Record<string, DocKind> = {
  pdf: "pdf",
  docx: "docx",
  md: "md",
  markdown: "md",
  mdx: "md",
  html: "html",
  htm: "html",
  txt: "txt",
  text: "txt",
  rst: "txt",
  csv: "txt",
  json: "code",
  yaml: "code",
  yml: "code",
  toml: "code",
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  mjs: "code",
  cjs: "code",
  py: "code",
  rb: "code",
  go: "code",
  rs: "code",
  java: "code",
  kt: "code",
  swift: "code",
  c: "code",
  h: "code",
  cc: "code",
  cpp: "code",
  hpp: "code",
  cs: "code",
  php: "code",
  sh: "code",
  bash: "code",
  sql: "code",
};

export function kindFromPath(path: string): DocKind | null {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? (EXT_TO_KIND[ext] ?? null) : null;
}

export function langFromPath(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    c: "c",
    h: "c",
    cc: "cpp",
    cpp: "cpp",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "shell",
    bash: "shell",
    sql: "sql",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
  };
  return map[ext];
}

/** Collapses the whitespace PDF and HTML extraction leaves behind. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    // Three or more blank lines carry no structure the chunker uses.
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function stripHtml(html: string): string {
  return tidy(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      // Turn structural tags into the blank lines the chunker splits on, and
      // headings into ATX markers, before discarding the rest.
      .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Number(n))} `)
      .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
      // Ampersand last, so "&amp;lt;" does not become "<".
      .replace(/&amp;/g, "&"),
  );
}

async function extractPdf(bytes: ArrayBuffer): Promise<Page[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(doc, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text])
    .map((t, i) => ({ page: i + 1, text: tidy(t) }))
    .filter((p) => p.text.length > 0);

  if (pages.length === 0) {
    throw new ExtractionError(
      "This PDF has no text layer — it is probably a scan. Run OCR over it first; " +
        "indexing it as-is would store an empty document.",
    );
  }
  return pages;
}

async function extractDocx(bytes: ArrayBuffer): Promise<Page[]> {
  const mammoth = await import("mammoth");
  // Raw text loses heading levels, so convert to HTML and re-derive them.
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const text = stripHtml(value);
  if (!text) throw new ExtractionError("The .docx contained no readable text.");
  return [{ page: null, text }];
}

export interface ExtractInput {
  kind: DocKind;
  /** For binary formats. */
  bytes?: ArrayBuffer;
  /** For anything already textual — connectors usually have this. */
  text?: string;
  /** Used to detect the code language when kind is "code". */
  path?: string;
}

export async function extract(input: ExtractInput): Promise<Extraction> {
  const base = { parserVersion: PARSER_VERSION };

  switch (input.kind) {
    case "pdf": {
      if (!input.bytes) throw new ExtractionError("PDF extraction needs bytes.");
      return { ...base, pages: await extractPdf(input.bytes) };
    }
    case "docx": {
      if (!input.bytes) throw new ExtractionError("DOCX extraction needs bytes.");
      return { ...base, pages: await extractDocx(input.bytes) };
    }
    case "html": {
      const text = stripHtml(input.text ?? decode(input.bytes));
      if (!text) throw new ExtractionError("The HTML contained no readable text.");
      return { ...base, pages: [{ page: null, text }] };
    }
    case "code": {
      const text = input.text ?? decode(input.bytes);
      if (!text.trim()) throw new ExtractionError("The file is empty.");
      // Never tidied: indentation is semantic in code, and collapsing blank
      // lines would merge functions the symbol chunker splits on.
      return {
        ...base,
        pages: [{ page: null, text: text.replace(/\r\n?/g, "\n") }],
        lang: input.path ? langFromPath(input.path) : undefined,
      };
    }
    default: {
      const text = tidy(input.text ?? decode(input.bytes));
      if (!text) throw new ExtractionError("The file is empty.");
      return { ...base, pages: [{ page: null, text }] };
    }
  }
}

function decode(bytes?: ArrayBuffer): string {
  if (!bytes) throw new ExtractionError("Nothing to extract — no bytes and no text.");
  return new TextDecoder("utf-8").decode(bytes);
}
