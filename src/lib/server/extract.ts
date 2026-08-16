import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import type { DocumentRecord } from "@/lib/types";

/**
 * File bytes to plain text, one entry per page where the format has pages.
 *
 * Keeping pages separate rather than concatenating is what lets a citation say
 * "p.14" — the chunker carries the page number through, and a chunk never
 * straddles a page boundary in a PDF.
 */

export type DocumentKind = DocumentRecord["kind"];

export interface PageText {
  /** 1-based. Null for formats with no pagination. */
  page: number | null;
  text: string;
}

const EXT_KIND: Record<string, DocumentKind> = {
  pdf: "pdf",
  md: "md",
  markdown: "md",
  txt: "txt",
  text: "txt",
  html: "html",
  htm: "html",
  docx: "docx",
};

export function kindFromName(name: string): DocumentKind | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_KIND[ext] ?? null;
}

export const ACCEPTED_EXTENSIONS = Object.keys(EXT_KIND);

/** Thrown for anything the user can fix by re-uploading a different file. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export async function extractDocument(
  bytes: ArrayBuffer,
  kind: DocumentKind,
): Promise<PageText[]> {
  const pages = await byKind(bytes, kind);
  const nonEmpty = pages.filter((p) => p.text.trim().length > 0);

  if (nonEmpty.length === 0) {
    throw new ExtractionError(
      kind === "pdf"
        ? "No extractable text layer — this looks like a scanned or encrypted PDF. Re-upload with OCR applied."
        : "The file contains no readable text.",
    );
  }
  return nonEmpty;
}

async function byKind(bytes: ArrayBuffer, kind: DocumentKind): Promise<PageText[]> {
  switch (kind) {
    case "pdf":
      return fromPdf(bytes);
    case "docx":
      return [{ page: null, text: await fromDocx(bytes) }];
    case "html":
      return [{ page: null, text: fromHtml(decode(bytes)) }];
    case "md":
    case "txt":
      return [{ page: null, text: decode(bytes) }];
  }
}

function decode(bytes: ArrayBuffer): string {
  // fatal:false so a stray invalid byte degrades to U+FFFD instead of failing
  // the whole ingest.
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\r\n?/g, "\n");
}

async function fromPdf(bytes: ArrayBuffer): Promise<PageText[]> {
  let perPage: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    ({ text: perPage } = await extractPdfText(pdf, { mergePages: false }));
  } catch (err) {
    throw new ExtractionError(
      `Could not open the PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return perPage.map((text, i) => ({ page: i + 1, text: tidyPdfText(text) }));
}

/**
 * pdf.js emits text items in layout order with no line structure. Two fixes
 * that matter for chunking: rejoin words broken across a line by a hyphen, and
 * treat a run of spaces as a paragraph break so the structure-first chunker
 * has something to split on.
 */
function tidyPdfText(text: string): string {
  return text
    .replace(/-\s+(?=[a-z])/g, "")
    .replace(/[ \t]{3,}/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fromDocx(bytes: ArrayBuffer): Promise<string> {
  try {
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });
    return value.replace(/\r\n?/g, "\n").trim();
  } catch (err) {
    throw new ExtractionError(
      `Could not read the .docx: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/**
 * Tag-stripping rather than DOM parsing. Headings are converted to markdown so
 * the chunker's structure pass still sees them, which is the only part of the
 * document tree that affects retrieval quality here.
 */
function fromHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => {
      const hashes = "#".repeat(Number(level));
      return `\n\n${hashes} ${inner.replace(/<[^>]+>/g, " ").trim()}\n\n`;
    })
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
