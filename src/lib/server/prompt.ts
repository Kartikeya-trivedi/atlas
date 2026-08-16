import type { Citation } from "@/lib/types";
import type { ServerChunk } from "./search";

/**
 * Context assembly and citation extraction.
 *
 * The marker a passage is given here is the marker the model must cite, and the
 * same number is what the chat UI turns into a clickable chip. Nothing
 * renumbers downstream — if the model writes [3], the third passage in this
 * block is what it is claiming to have used.
 */

/** Ceiling on context handed to the model, independent of topK. */
const MAX_CONTEXT_CHARS = 60_000;

export interface BuiltContext {
  block: string;
  /** Passages that actually fit, in marker order. Marker is 1-based index + 1. */
  used: ServerChunk[];
}

export function buildContext(chunks: ServerChunk[]): BuiltContext {
  const used: ServerChunk[] = [];
  const parts: string[] = [];
  let budget = MAX_CONTEXT_CHARS;

  for (const c of chunks) {
    const source = [c.heading ?? c.documentTitle, c.page ? `p.${c.page}` : null]
      .filter(Boolean)
      .join(" · ");
    const entry = `[${used.length + 1}] ${source}\n${c.content}`;
    if (entry.length > budget && used.length > 0) break;
    budget -= entry.length;
    used.push(c);
    parts.push(entry);
  }

  return { block: parts.join("\n\n---\n\n"), used };
}

export function buildSystemInstruction(userPrompt: string, strict: boolean): string {
  const rules = [
    "Answer only from the passages provided in the user message.",
    "Cite with the bracketed marker of the passage you used, like [2], placed at the end of the sentence it supports. Cite every factual claim.",
    "Never cite a marker that does not appear in the context.",
    strict
      ? "If the passages do not contain the answer, say so plainly and name what is missing. Do not fall back on general knowledge."
      : "If the passages are incomplete, answer what they support, then state clearly which part is not covered by the context.",
    "Do not repeat the passages verbatim at length — synthesise.",
  ];

  return `${userPrompt.trim()}\n\nRules:\n${rules.map((r) => `- ${r}`).join("\n")}`;
}

export function buildPrompt(query: string, context: string): string {
  return `Context passages:\n\n${context}\n\n---\n\nQuestion: ${query}`;
}

/** First sentence or two of a chunk, trimmed to something quotable. */
function lead(content: string, max = 240): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const parts = flat.split(/(?<=[.!?])\s+/);
  let out = parts[0] ?? flat;
  if (out.length < 90 && parts[1]) out += ` ${parts[1]}`;
  if (out.length > max) out = `${out.slice(0, max).replace(/\s+\S*$/, "")}…`;
  return out;
}

/**
 * Citations for the markers the model actually wrote.
 *
 * Listing every retrieved passage would overstate the grounding — the sources
 * panel should show what the answer leans on, not what retrieval happened to
 * return. Markers pointing outside the context are dropped here; the chat
 * renderer leaves the bare `[n]` visible in the text so the hallucinated
 * reference is still apparent.
 */
export function extractCitations(answer: string, used: ServerChunk[]): Citation[] {
  const seen = new Set<number>();
  const out: Citation[] = [];

  for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const marker = Number(match[1]);
    if (seen.has(marker)) continue;
    const chunk = used[marker - 1];
    if (!chunk) continue;
    seen.add(marker);
    out.push({
      marker,
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentTitle: chunk.documentTitle,
      page: chunk.page,
      snippet: lead(chunk.content),
    });
  }

  return out.sort((a, b) => a.marker - b.marker);
}
