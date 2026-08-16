import type { ProviderId } from "./types";

/**
 * Model catalog: which provider serves a model, what it costs, and what it
 * refuses to accept.
 *
 * `supportsSampling` is load-bearing, not cosmetic. Anthropic removed
 * temperature/top_p/top_k on Opus 4.7 and later — sending any of them returns a
 * 400 rather than being ignored. A provider-agnostic caller that always passes
 * a temperature would break on exactly the newest models, so the adapter reads
 * this flag and drops the parameter.
 *
 * Prices are USD per million tokens. Anthropic figures verified against
 * published rates 2026-06-24; the Gemini and OpenAI figures are best-effort and
 * should be re-checked against each provider's pricing page before anyone
 * quotes a cost-per-query number externally. Override any of them with no code
 * change via ATLAS_PRICE_OVERRIDES (JSON: {"model-id":{"in":1.23,"out":4.56}}).
 */

export interface ModelSpec {
  provider: ProviderId;
  /** USD per 1M input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens. Zero for embedding models. */
  outputPer1M: number;
  maxOutput: number;
  contextWindow: number;
  /** False → the adapter must not send temperature/top_p/top_k. */
  supportsSampling: boolean;
  /** Native constrained decoding against a JSON Schema. */
  supportsJsonSchema: boolean;
  embedding?: boolean;
}

export const MODELS: Record<string, ModelSpec> = {
  // ── anthropic ────────────────────────────────────────────────────────────
  // Sampling parameters return a 400 across this family (Haiku 4.5 excepted).
  "claude-opus-5": {
    provider: "anthropic",
    inputPer1M: 5,
    outputPer1M: 25,
    maxOutput: 128_000,
    contextWindow: 1_000_000,
    supportsSampling: false,
    supportsJsonSchema: true,
  },
  "claude-sonnet-5": {
    provider: "anthropic",
    inputPer1M: 3,
    outputPer1M: 15,
    maxOutput: 128_000,
    contextWindow: 1_000_000,
    supportsSampling: false,
    supportsJsonSchema: true,
  },
  "claude-opus-4-8": {
    provider: "anthropic",
    inputPer1M: 5,
    outputPer1M: 25,
    maxOutput: 128_000,
    contextWindow: 1_000_000,
    supportsSampling: false,
    supportsJsonSchema: true,
  },
  "claude-haiku-4-5": {
    provider: "anthropic",
    inputPer1M: 1,
    outputPer1M: 5,
    maxOutput: 64_000,
    contextWindow: 200_000,
    supportsSampling: true,
    supportsJsonSchema: true,
  },

  // ── gemini ───────────────────────────────────────────────────────────────
  "gemini-2.5-flash": {
    provider: "gemini",
    inputPer1M: 0.3,
    outputPer1M: 2.5,
    maxOutput: 65_536,
    contextWindow: 1_048_576,
    supportsSampling: true,
    supportsJsonSchema: true,
  },
  "gemini-2.5-pro": {
    provider: "gemini",
    inputPer1M: 1.25,
    outputPer1M: 10,
    maxOutput: 65_536,
    contextWindow: 1_048_576,
    supportsSampling: true,
    supportsJsonSchema: true,
  },
  "gemini-2.0-flash": {
    provider: "gemini",
    inputPer1M: 0.1,
    outputPer1M: 0.4,
    maxOutput: 8192,
    contextWindow: 1_048_576,
    supportsSampling: true,
    supportsJsonSchema: true,
  },
  "gemini-embedding-001": {
    provider: "gemini",
    inputPer1M: 0.15,
    outputPer1M: 0,
    maxOutput: 0,
    contextWindow: 2048,
    supportsSampling: false,
    supportsJsonSchema: false,
    embedding: true,
  },

  // ── openai ───────────────────────────────────────────────────────────────
  "gpt-4.1-mini": {
    provider: "openai",
    inputPer1M: 0.4,
    outputPer1M: 1.6,
    maxOutput: 32_768,
    contextWindow: 1_047_576,
    supportsSampling: true,
    supportsJsonSchema: true,
  },
  "text-embedding-3-small": {
    provider: "openai",
    inputPer1M: 0.02,
    outputPer1M: 0,
    maxOutput: 0,
    contextWindow: 8191,
    supportsSampling: false,
    supportsJsonSchema: false,
    embedding: true,
  },
};

let overrides: Record<string, { in?: number; out?: number }> | null = null;

function priceOverrides(): Record<string, { in?: number; out?: number }> {
  if (overrides) return overrides;
  const raw = process.env.ATLAS_PRICE_OVERRIDES;
  if (!raw) return (overrides = {});
  try {
    overrides = JSON.parse(raw) as Record<string, { in?: number; out?: number }>;
  } catch {
    console.warn("[atlas] ATLAS_PRICE_OVERRIDES is not valid JSON — ignoring");
    overrides = {};
  }
  return overrides;
}

export function specFor(model: string): ModelSpec {
  const spec = MODELS[model];
  if (!spec) {
    throw new Error(
      `Unknown model "${model}". Add it to src/lib/llm/registry.ts — an ` +
        `unpriced model would silently report a cost of zero.`,
    );
  }
  return spec;
}

export function providerFor(model: string): ProviderId {
  return specFor(model).provider;
}

/**
 * Cost in USD. Cached input tokens bill at 10% of the input rate across all
 * three providers — close enough to exact for a budget check.
 */
export function costOf(
  model: string,
  input: number,
  output: number,
  cached = 0,
): number {
  const spec = specFor(model);
  const o = priceOverrides()[model];
  const inRate = o?.in ?? spec.inputPer1M;
  const outRate = o?.out ?? spec.outputPer1M;
  const billableInput = Math.max(0, input - cached);
  return (
    (billableInput * inRate) / 1e6 +
    (cached * inRate * 0.1) / 1e6 +
    (output * outRate) / 1e6
  );
}

/** ~4 characters per token holds well enough for English prose to size batches. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export const GENERATION_MODELS = Object.entries(MODELS)
  .filter(([, s]) => !s.embedding)
  .map(([id]) => id);

export const EMBEDDING_MODELS = Object.entries(MODELS)
  .filter(([, s]) => s.embedding)
  .map(([id]) => id);
