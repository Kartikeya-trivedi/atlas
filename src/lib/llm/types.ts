/** Provider-agnostic LLM contracts. Nothing above this layer names a vendor. */

export type ProviderId = "gemini" | "openai" | "anthropic";

/** What the call was for. Drives cost attribution in llm_calls.purpose. */
export type Purpose =
  | "embed"
  | "rewrite"
  | "plan"
  | "rerank"
  | "answer"
  | "verify"
  | "contextualise";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  ms: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  costUsd: 0,
  ms: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    costUsd: a.costUsd + b.costUsd,
    ms: a.ms + b.ms,
  };
}

/**
 * Corpus chunks embed as `document`, the user's question as `query`.
 *
 * The same text produces different vectors under each, and mixing them degrades
 * recall without raising an error anywhere — which is why this is a required
 * field rather than an option with a default.
 */
export type EmbedKind = "document" | "query";

export interface EmbedRequest {
  model: string;
  texts: string[];
  kind: EmbedKind;
  dim: number;
  signal?: AbortSignal;
}

export interface EmbedResult {
  /** Unit-length. Providers returning unnormalised truncations are fixed here. */
  vectors: number[][];
  usage: Usage;
}

export interface ChatRequest {
  model: string;
  system?: string;
  prompt: string;
  maxTokens: number;
  /**
   * Dropped for models that reject sampling parameters — see
   * ModelSpec.supportsSampling. Dropping rather than erroring is deliberate:
   * the caller wanted determinism, and those models are near-deterministic by
   * default, so the intent survives even though the knob does not.
   */
  temperature?: number;
  /** When set, the reply is constrained to this JSON Schema. */
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type StopReason =
  | "stop"
  | "max_tokens"
  | "refusal"
  | "safety"
  | "error"
  | "other";

export interface ChatResult {
  text: string;
  usage: Usage;
  stopReason: StopReason;
}

/** Terminal value of a streamed completion. */
export interface StreamEnd {
  usage: Usage;
  stopReason: StopReason;
}

export interface Provider {
  readonly id: ProviderId;
  embed(req: EmbedRequest): Promise<EmbedResult>;
  complete(req: ChatRequest): Promise<ChatResult>;
  stream(req: ChatRequest): AsyncGenerator<string, StreamEnd, void>;
}

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly status?: number;
  readonly retryable: boolean;
  constructor(
    provider: ProviderId,
    message: string,
    opts: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(`[${provider}] ${message}`, { cause: opts.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.status = opts.status;
    // Unknown failures count as retryable: a network blip is far more common
    // than a permanently malformed request that got this far.
    this.retryable = opts.retryable ?? true;
  }
}
