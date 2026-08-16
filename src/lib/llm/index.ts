import { env } from "@/lib/core/env";
import { PROVIDERS } from "./providers";
import { costOf, providerFor, specFor } from "./registry";
import {
  ProviderError,
  ZERO_USAGE,
  addUsage,
  type ChatRequest,
  type ChatResult,
  type EmbedKind,
  type Purpose,
  type StreamEnd,
  type Usage,
} from "./types";

export * from "./types";
export {
  EMBEDDING_MODELS,
  GENERATION_MODELS,
  MODELS,
  costOf,
  estimateTokens,
  specFor,
} from "./registry";

/**
 * The facade every caller uses. Picks the provider from the model id, retries
 * transient failures, and reports usage to whoever is accounting for it.
 */

const MAX_ATTEMPTS = 4;
/** Upper bound per embed request; larger inputs are split automatically. */
const EMBED_BATCH = 100;

/* ─────────────────────────────────────────────────────────────── accounting ── */

export interface UsageEvent extends Usage {
  provider: string;
  model: string;
  purpose: Purpose;
  error?: string;
}

type UsageSink = (event: UsageEvent) => void;

let sink: UsageSink | null = null;

/**
 * Registered once by the observability layer. A module-level hook rather than a
 * parameter so no call site has to thread a recorder through — an unattributed
 * LLM call is the normal way cost tracking quietly becomes wrong.
 */
export function setUsageSink(fn: UsageSink | null): void {
  sink = fn;
}

function record(model: string, purpose: Purpose, usage: Usage, error?: string): void {
  if (!sink) return;
  try {
    sink({ ...usage, provider: providerFor(model), model, purpose, error });
  } catch (err) {
    console.error("[atlas] usage sink threw:", err);
  }
}

/* ───────────────────────────────────────────────────────────────── retrying ── */

function statusOf(err: unknown): number | undefined {
  if (err instanceof ProviderError) return err.status;
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  if (typeof e.status === "number") return e.status;
  if (typeof e.code === "number") return e.code;
  const m = typeof e.message === "string" ? /\b(4\d{2}|5\d{2})\b/.exec(e.message) : null;
  return m ? Number(m[1]) : undefined;
}

/** 429 and 5xx are worth another try; 400/401/403 are not. */
function retryable(err: unknown): boolean {
  if (err instanceof ProviderError) return err.retryable;
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
  throw last instanceof Error
    ? new Error(`${label}: ${last.message}`, { cause: last })
    : new Error(`${label}: ${String(last)}`);
}

/* ─────────────────────────────────────────────────────────────── embeddings ── */

export interface EmbedOptions {
  model?: string;
  dim?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void | Promise<void>;
}

/**
 * Embeds in batches, halving on failure.
 *
 * Splitting rather than failing covers both ways a batch can be rejected — too
 * many inputs, or too many tokens across them — without having to know which
 * happened, and degrades to one-at-a-time in the worst case.
 */
async function embedChunked(
  model: string,
  texts: string[],
  kind: EmbedKind,
  dim: number,
  signal: AbortSignal | undefined,
  usage: { total: Usage },
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const provider = PROVIDERS[providerFor(model)];
  try {
    const res = await withRetry(
      () => provider.embed({ model, texts, kind, dim, signal }),
      "embed",
    );
    usage.total = addUsage(usage.total, res.usage);
    return res.vectors;
  } catch (err) {
    if (texts.length === 1) throw err;
    const mid = Math.ceil(texts.length / 2);
    const [a, b] = await Promise.all([
      embedChunked(model, texts.slice(0, mid), kind, dim, signal, usage),
      embedChunked(model, texts.slice(mid), kind, dim, signal, usage),
    ]);
    return [...a, ...b];
  }
}

export async function embed(
  texts: string[],
  kind: EmbedKind,
  opts: EmbedOptions = {},
): Promise<{ vectors: number[][]; usage: Usage }> {
  const cfg = env();
  const model = opts.model ?? cfg.ATLAS_EMBEDDING_MODEL;
  const dim = opts.dim ?? cfg.ATLAS_EMBEDDING_DIM;
  const acc = { total: ZERO_USAGE };
  const all: number[][] = [];

  try {
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      all.push(...(await embedChunked(model, batch, kind, dim, opts.signal, acc)));
      await opts.onProgress?.(all.length, texts.length);
    }
  } finally {
    record(model, "embed", acc.total);
  }

  return { vectors: all, usage: acc.total };
}

export async function embedOne(
  text: string,
  kind: EmbedKind,
  opts: EmbedOptions = {},
): Promise<{ vector: number[]; usage: Usage }> {
  const { vectors, usage } = await embed([text], kind, opts);
  const vector = vectors[0];
  if (!vector) throw new Error("embed returned no vector");
  return { vector, usage };
}

/* ─────────────────────────────────────────────────────────────── generation ── */

export interface CompleteOptions extends Omit<ChatRequest, "model" | "maxTokens"> {
  model?: string;
  maxTokens?: number;
  purpose: Purpose;
}

export async function complete(opts: CompleteOptions): Promise<ChatResult> {
  const model = opts.model ?? env().ATLAS_GENERATION_MODEL;
  const provider = PROVIDERS[providerFor(model)];
  const req: ChatRequest = {
    model,
    system: opts.system,
    prompt: opts.prompt,
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature,
    jsonSchema: opts.jsonSchema,
    signal: opts.signal,
  };

  try {
    const res = await withRetry(() => provider.complete(req), opts.purpose);
    record(model, opts.purpose, res.usage);
    return res;
  } catch (err) {
    record(
      model,
      opts.purpose,
      ZERO_USAGE,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

/**
 * Structured generation.
 *
 * Prefers native schema-constrained decoding where the model supports it, and
 * falls back to extracting the first JSON value from the text otherwise. The
 * fallback matters: a model without constrained decoding still usually answers
 * correctly, just wrapped in a code fence or a sentence of preamble.
 */
export async function completeJson<T>(
  opts: CompleteOptions & { schema: Record<string, unknown> },
): Promise<{ value: T | null; raw: string; usage: Usage }> {
  const model = opts.model ?? env().ATLAS_GENERATION_MODEL;
  const native = specFor(model).supportsJsonSchema;

  const res = await complete({
    ...opts,
    model,
    jsonSchema: native ? opts.schema : undefined,
    prompt: native
      ? opts.prompt
      : `${opts.prompt}\n\nReply with JSON matching this schema and nothing else:\n` +
        JSON.stringify(opts.schema),
  });

  return { value: parseJson<T>(res.text), raw: res.text, usage: res.usage };
}

/** First JSON object or array in the text, or null. Tolerates code fences. */
export function parseJson<T>(text: string): T | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const match = /[[{][\s\S]*[\]}]/.exec(trimmed);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

export async function* stream(
  opts: CompleteOptions,
): AsyncGenerator<string, StreamEnd, void> {
  const model = opts.model ?? env().ATLAS_GENERATION_MODEL;
  const provider = PROVIDERS[providerFor(model)];

  // Not retried: tokens already delivered to the client cannot be un-sent, so a
  // mid-stream failure surfaces rather than silently restarting the answer.
  const generator = provider.stream({
    model,
    system: opts.system,
    prompt: opts.prompt,
    maxTokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature,
    signal: opts.signal,
  });

  try {
    while (true) {
      const { value, done } = await generator.next();
      if (done) {
        record(model, opts.purpose, value.usage);
        return value;
      }
      yield value;
    }
  } catch (err) {
    record(
      model,
      opts.purpose,
      ZERO_USAGE,
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

/** Cost of a hypothetical call, for budget checks before spending anything. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  return costOf(model, inputTokens, outputTokens);
}
