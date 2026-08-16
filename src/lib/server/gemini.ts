import { GoogleGenAI } from "@google/genai";
import { serverConfig } from "./env";

/**
 * Every call into Gemini lives here.
 *
 * Two things this module is careful about, both of which fail silently rather
 * than loudly if you get them wrong:
 *
 *  1. task_type. Corpus chunks are embedded as RETRIEVAL_DOCUMENT, the user's
 *     question as RETRIEVAL_QUERY. The same text produces different vectors
 *     under each, and mixing them degrades recall without raising an error.
 *  2. output dimensionality. gemini-embedding-001 only returns unit-norm
 *     vectors at its native 3072; every truncated size comes back unnormalised
 *     and must be scaled before it is stored, or cosine distance in Postgres
 *     is computed against vectors of inconsistent length.
 */

/** Models the UI is allowed to select. Anything else falls back to the env default. */
export const GENERATION_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
] as const;

export type GenerationModel = (typeof GENERATION_MODELS)[number];

/** Upper bound per embed request. Larger batches are split automatically. */
const EMBED_BATCH = 100;
const MAX_ATTEMPTS = 4;

let client: GoogleGenAI | null = null;

function genai(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: serverConfig().geminiApiKey });
  return client;
}

export function resolveGenerationModel(requested?: string): string {
  const fallback = serverConfig().generationModel;
  if (!requested) return fallback;
  return (GENERATION_MODELS as readonly string[]).includes(requested)
    ? requested
    : fallback;
}

/* ------------------------------------------------------------- retrying --- */

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof e.status === "number") return e.status;
  if (typeof e.code === "number") return e.code;
  const m = typeof e.message === "string" ? /\b(4\d{2}|5\d{2})\b/.exec(e.message) : null;
  return m ? Number(m[1]) : undefined;
}

/** 429 and 5xx are worth another try; 400/401/403 are not. */
function retryable(err: unknown): boolean {
  const s = statusOf(err);
  if (s === undefined) return true; // network-level failure
  return s === 429 || s >= 500;
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!retryable(err) || attempt === MAX_ATTEMPTS - 1) break;
      // Exponential with jitter, so a burst of parallel batches does not all
      // come back at the same instant and rate-limit each other again.
      const wait = 400 * 2 ** attempt + Math.random() * 250;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error(`${label}: ${last instanceof Error ? last.message : String(last)}`, {
    cause: last,
  });
}

/* ----------------------------------------------------------- embeddings --- */

function l2normalise(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm > 0 ? v.map((x) => x / norm) : v;
}

async function embedOnce(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][]> {
  const cfg = serverConfig();
  const res = await genai().models.embedContent({
    model: cfg.embedModel,
    contents: texts,
    config: { taskType, outputDimensionality: cfg.embedDim },
  });

  const out = res.embeddings ?? [];
  if (out.length !== texts.length) {
    throw new Error(`expected ${texts.length} embeddings, received ${out.length}`);
  }

  return out.map((e, i) => {
    const values = e.values;
    if (!values?.length) throw new Error(`empty embedding at index ${i}`);
    if (values.length !== cfg.embedDim) {
      throw new Error(
        `embedding is ${values.length}-dimensional but GEMINI_EMBED_DIM is ${cfg.embedDim}; ` +
          `the vector(N) column must match`,
      );
    }
    return l2normalise(values);
  });
}

/**
 * Embeds in batches, halving on failure.
 *
 * Splitting rather than failing covers both of the ways a batch can be
 * rejected — too many inputs, or too many tokens across them — without having
 * to know which one happened, and degrades to one-at-a-time in the worst case.
 */
async function embedChunked(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[][]> {
  if (texts.length === 0) return [];

  try {
    return await withRetry(() => embedOnce(texts, taskType), "embedContent");
  } catch (err) {
    if (texts.length === 1) throw err;
    const mid = Math.ceil(texts.length / 2);
    const [a, b] = await Promise.all([
      embedChunked(texts.slice(0, mid), taskType),
      embedChunked(texts.slice(mid), taskType),
    ]);
    return [...a, ...b];
  }
}

/**
 * Embeds corpus chunks. `onProgress` reports completed fraction so the ingest
 * route can stream a real percentage into the documents row.
 */
export async function embedDocuments(
  texts: string[],
  onProgress?: (done: number, total: number) => void | Promise<void>,
): Promise<number[][]> {
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    all.push(...(await embedChunked(batch, "RETRIEVAL_DOCUMENT")));
    await onProgress?.(all.length, texts.length);
  }
  return all;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedChunked([text], "RETRIEVAL_QUERY");
  return v;
}

/* ----------------------------------------------------------- generation --- */

/**
 * 2.5-series models think before answering, and thinking tokens are drawn from
 * maxOutputTokens. On a grounded extractive task that spends the budget for no
 * benefit, and at low limits it can consume the whole allowance and return an
 * empty candidate. Pro cannot disable it, so it keeps its default.
 */
function thinkingFor(model: string) {
  return model.startsWith("gemini-2.5-flash")
    ? { thinkingConfig: { thinkingBudget: 0 } }
    : {};
}

export interface StreamOptions {
  model: string;
  systemInstruction: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface StreamResult {
  /** Set when the model stopped for any reason other than reaching the end. */
  finishReason?: string;
}

/** Yields answer deltas; returns why the model stopped. */
export async function* streamAnswer(
  opts: StreamOptions,
): AsyncGenerator<string, StreamResult, void> {
  const stream = await genai().models.generateContentStream({
    model: opts.model,
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    config: {
      systemInstruction: opts.systemInstruction,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.signal,
      ...thinkingFor(opts.model),
    },
  });

  let finishReason: string | undefined;
  for await (const chunk of stream) {
    if (opts.signal?.aborted) break;
    const reason = chunk.candidates?.[0]?.finishReason;
    if (reason) finishReason = String(reason);
    const text = chunk.text;
    if (text) yield text;
  }

  return {
    finishReason:
      finishReason && finishReason !== "STOP" ? finishReason : undefined,
  };
}

/** One-shot generation used by the rewriter and the reranker. */
async function generateText(
  model: string,
  prompt: string,
  maxOutputTokens: number,
  signal?: AbortSignal,
): Promise<string> {
  const res = await withRetry(
    () =>
      genai().models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0,
          maxOutputTokens,
          abortSignal: signal,
          ...thinkingFor(model),
        },
      }),
    "generateContent",
  );
  return res.text?.trim() ?? "";
}

/**
 * Turns a follow-up into a standalone query.
 *
 * Retrieval has no conversation history — "what about the other one?" embeds
 * to nothing useful. The rewrite is deliberately conservative: on anything
 * unexpected it returns the original rather than a worse query.
 */
export async function rewriteQuery(
  model: string,
  query: string,
  history: { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<string> {
  const recent = history
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const prompt =
    `Rewrite the user's latest message as a single standalone search query for a ` +
    `document retrieval system. Resolve pronouns and implicit references using the ` +
    `conversation. Keep every identifier, error code, function name and version ` +
    `string exactly as written — they are what the keyword channel matches on. ` +
    `Do not answer the question. Reply with the query and nothing else.\n\n` +
    (recent ? `Conversation:\n${recent}\n\n` : "") +
    `Latest message: ${query}\n\nStandalone query:`;

  try {
    const out = await generateText(model, prompt, 128, signal);
    const cleaned = out.split("\n")[0]?.replace(/^["']|["']$/g, "").trim() ?? "";
    // A rewrite that collapsed to nothing, or ballooned, is a failed rewrite.
    if (!cleaned || cleaned.length > query.length * 6 + 120) return query;
    return cleaned;
  } catch {
    return query;
  }
}

/**
 * LLM reranker over the fused shortlist.
 *
 * A real cross-encoder scores the query and passage jointly in one forward
 * pass; this asks the generation model for the same judgement in one call over
 * the whole shortlist. Same shape of win — it sees the pair, not two
 * independent vectors — at one round trip instead of N.
 *
 * Returns relevance in 0..1 per input index. On any parse failure it returns
 * null and the caller keeps the fusion order.
 */
export async function rerankPassages(
  model: string,
  query: string,
  passages: string[],
  signal?: AbortSignal,
): Promise<number[] | null> {
  if (passages.length === 0) return [];

  const listed = passages
    .map((p, i) => `[${i}] ${p.slice(0, 1200).replace(/\s+/g, " ")}`)
    .join("\n\n");

  const prompt =
    `Score how well each passage answers the query, from 0 (irrelevant) to 10 ` +
    `(directly answers it). Judge the passage on its own content, not on its ` +
    `position in the list.\n\n` +
    `Query: ${query}\n\nPassages:\n${listed}\n\n` +
    `Reply with only a JSON array of ${passages.length} numbers, in the same order ` +
    `as the passages. No prose, no code fence.`;

  try {
    const raw = await generateText(model, prompt, 512, signal);
    const match = /\[[\s\S]*?\]/.exec(raw);
    if (!match) return null;
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed) || parsed.length !== passages.length) return null;
    const scores = parsed.map((n) =>
      typeof n === "number" && Number.isFinite(n)
        ? Math.min(1, Math.max(0, n / 10))
        : 0,
    );
    return scores;
  } catch {
    return null;
  }
}
