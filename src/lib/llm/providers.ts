import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { env } from "@/lib/core/env";
import { costOf, specFor } from "./registry";
import {
  ProviderError,
  type ChatRequest,
  type ChatResult,
  type EmbedRequest,
  type EmbedResult,
  type Provider,
  type StopReason,
  type StreamEnd,
} from "./types";

/** Truncated Matryoshka outputs are not unit-length; cosine needs them to be. */
function l2normalise(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  return norm > 0 ? v.map((x) => x / norm) : v;
}

function missingKey(provider: string, name: string): never {
  throw new ProviderError(provider as never, `${name} is not set`, {
    retryable: false,
  });
}

/* ────────────────────────────────────────────────────────────────── gemini ── */

let geminiClient: GoogleGenAI | null = null;

function gemini(): GoogleGenAI {
  if (geminiClient) return geminiClient;
  const key = env().GEMINI_API_KEY;
  if (!key) missingKey("gemini", "GEMINI_API_KEY");
  return (geminiClient = new GoogleGenAI({ apiKey: key }));
}

/**
 * 2.5-series models think before answering, and thinking tokens come out of
 * maxOutputTokens. On a grounded extractive task that spends the budget for no
 * benefit, and at low limits it can consume the whole allowance and return an
 * empty candidate. Pro cannot disable it, so it keeps its default.
 */
function geminiThinking(model: string) {
  return model.startsWith("gemini-2.5-flash")
    ? { thinkingConfig: { thinkingBudget: 0 } }
    : {};
}

function geminiStop(reason: string | undefined): StopReason {
  switch (reason) {
    case undefined:
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "PROHIBITED_CONTENT":
      return "safety";
    default:
      return "other";
  }
}

export const geminiProvider: Provider = {
  id: "gemini",

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const started = performance.now();
    const res = await gemini().models.embedContent({
      model: req.model,
      contents: req.texts,
      config: {
        taskType: req.kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
        outputDimensionality: req.dim,
      },
    });

    const out = res.embeddings ?? [];
    if (out.length !== req.texts.length) {
      throw new ProviderError(
        "gemini",
        `expected ${req.texts.length} embeddings, received ${out.length}`,
      );
    }

    const vectors = out.map((e, i) => {
      const values = e.values;
      if (!values?.length) {
        throw new ProviderError("gemini", `empty embedding at index ${i}`);
      }
      if (values.length !== req.dim) {
        throw new ProviderError(
          "gemini",
          `embedding is ${values.length}-dimensional but ATLAS_EMBEDDING_DIM is ` +
            `${req.dim}; the vector(N) column must match`,
          { retryable: false },
        );
      }
      return l2normalise(values);
    });

    const inputTokens = req.texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
    return {
      vectors,
      usage: {
        inputTokens,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: costOf(req.model, inputTokens, 0),
        ms: Math.round(performance.now() - started),
      },
    };
  },

  async complete(req: ChatRequest): Promise<ChatResult> {
    const started = performance.now();
    const spec = specFor(req.model);
    const res = await gemini().models.generateContent({
      model: req.model,
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      config: {
        systemInstruction: req.system,
        maxOutputTokens: Math.min(req.maxTokens, spec.maxOutput),
        abortSignal: req.signal,
        ...(spec.supportsSampling && req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
        ...(req.jsonSchema
          ? { responseMimeType: "application/json", responseSchema: req.jsonSchema }
          : {}),
        ...geminiThinking(req.model),
      },
    });

    const u = res.usageMetadata;
    const inputTokens = u?.promptTokenCount ?? 0;
    const outputTokens = u?.candidatesTokenCount ?? 0;
    const cachedTokens = u?.cachedContentTokenCount ?? 0;

    return {
      text: res.text?.trim() ?? "",
      stopReason: geminiStop(res.candidates?.[0]?.finishReason as string | undefined),
      usage: {
        inputTokens,
        outputTokens,
        cachedTokens,
        costUsd: costOf(req.model, inputTokens, outputTokens, cachedTokens),
        ms: Math.round(performance.now() - started),
      },
    };
  },

  async *stream(req: ChatRequest): AsyncGenerator<string, StreamEnd, void> {
    const started = performance.now();
    const spec = specFor(req.model);
    const stream = await gemini().models.generateContentStream({
      model: req.model,
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      config: {
        systemInstruction: req.system,
        maxOutputTokens: Math.min(req.maxTokens, spec.maxOutput),
        abortSignal: req.signal,
        ...(spec.supportsSampling && req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
        ...geminiThinking(req.model),
      },
    });

    let stopReason: StopReason = "stop";
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;

    for await (const chunk of stream) {
      if (req.signal?.aborted) break;
      const reason = chunk.candidates?.[0]?.finishReason as string | undefined;
      if (reason) stopReason = geminiStop(reason);
      // Every chunk carries cumulative usage; the last one wins.
      if (chunk.usageMetadata) {
        inputTokens = chunk.usageMetadata.promptTokenCount ?? inputTokens;
        outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
        cachedTokens = chunk.usageMetadata.cachedContentTokenCount ?? cachedTokens;
      }
      const text = chunk.text;
      if (text) yield text;
    }

    return {
      stopReason,
      usage: {
        inputTokens,
        outputTokens,
        cachedTokens,
        costUsd: costOf(req.model, inputTokens, outputTokens, cachedTokens),
        ms: Math.round(performance.now() - started),
      },
    };
  },
};

/* ────────────────────────────────────────────────────────────────── openai ── */

let openaiClient: OpenAI | null = null;

function openai(): OpenAI {
  if (openaiClient) return openaiClient;
  const key = env().OPENAI_API_KEY;
  if (!key) missingKey("openai", "OPENAI_API_KEY");
  return (openaiClient = new OpenAI({ apiKey: key }));
}

function openaiStop(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "stop":
    case null:
    case undefined:
      return "stop";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "safety";
    default:
      return "other";
  }
}

export const openaiProvider: Provider = {
  id: "openai",

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const started = performance.now();
    const res = await openai().embeddings.create(
      { model: req.model, input: [...req.texts], dimensions: req.dim },
      { signal: req.signal },
    );
    // Response order is not promised; the index field is.
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    const inputTokens = res.usage?.prompt_tokens ?? 0;
    return {
      vectors: sorted.map((d) => l2normalise(d.embedding)),
      usage: {
        inputTokens,
        outputTokens: 0,
        cachedTokens: 0,
        costUsd: costOf(req.model, inputTokens, 0),
        ms: Math.round(performance.now() - started),
      },
    };
  },

  async complete(req: ChatRequest): Promise<ChatResult> {
    const started = performance.now();
    const spec = specFor(req.model);
    const res = await openai().chat.completions.create(
      {
        model: req.model,
        max_tokens: Math.min(req.maxTokens, spec.maxOutput),
        messages: [
          ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
          { role: "user" as const, content: req.prompt },
        ],
        ...(spec.supportsSampling && req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
        ...(req.jsonSchema
          ? {
              response_format: {
                type: "json_schema" as const,
                json_schema: {
                  name: "atlas_response",
                  schema: req.jsonSchema,
                  strict: true,
                },
              },
            }
          : {}),
      },
      { signal: req.signal },
    );

    const choice = res.choices[0];
    const inputTokens = res.usage?.prompt_tokens ?? 0;
    const outputTokens = res.usage?.completion_tokens ?? 0;
    const cachedTokens = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;

    return {
      text: choice?.message?.content?.trim() ?? "",
      stopReason: openaiStop(choice?.finish_reason),
      usage: {
        inputTokens,
        outputTokens,
        cachedTokens,
        costUsd: costOf(req.model, inputTokens, outputTokens, cachedTokens),
        ms: Math.round(performance.now() - started),
      },
    };
  },

  async *stream(req: ChatRequest): AsyncGenerator<string, StreamEnd, void> {
    const started = performance.now();
    const spec = specFor(req.model);
    const stream = await openai().chat.completions.create(
      {
        model: req.model,
        max_tokens: Math.min(req.maxTokens, spec.maxOutput),
        stream: true,
        // Usage is omitted from streamed responses unless asked for explicitly.
        stream_options: { include_usage: true },
        messages: [
          ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
          { role: "user" as const, content: req.prompt },
        ],
        ...(spec.supportsSampling && req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
      },
      { signal: req.signal },
    );

    let stopReason: StopReason = "stop";
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;

    for await (const chunk of stream) {
      if (req.signal?.aborted) break;
      const choice = chunk.choices[0];
      if (choice?.finish_reason) stopReason = openaiStop(choice.finish_reason);
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
        cachedTokens =
          chunk.usage.prompt_tokens_details?.cached_tokens ?? cachedTokens;
      }
      const delta = choice?.delta?.content;
      if (delta) yield delta;
    }

    return {
      stopReason,
      usage: {
        inputTokens,
        outputTokens,
        cachedTokens,
        costUsd: costOf(req.model, inputTokens, outputTokens, cachedTokens),
        ms: Math.round(performance.now() - started),
      },
    };
  },
};

/* ─────────────────────────────────────────────────────────────── anthropic ── */

let anthropicClient: Anthropic | null = null;

function anthropic(): Anthropic {
  if (anthropicClient) return anthropicClient;
  const key = env().ANTHROPIC_API_KEY;
  if (!key) missingKey("anthropic", "ANTHROPIC_API_KEY");
  return (anthropicClient = new Anthropic({ apiKey: key }));
}

function anthropicStop(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
    case null:
    case undefined:
      return "stop";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

/**
 * Two things this adapter has to get right that the others do not:
 *
 *  1. Sampling parameters were removed on Opus 4.7 and later — sending a
 *     temperature returns a 400 rather than being ignored. `supportsSampling`
 *     in the registry gates it.
 *  2. `stop_reason: "refusal"` arrives as a successful HTTP 200 with empty or
 *     partial content. Code that reads content[0] unconditionally breaks on it,
 *     so the stop reason is checked before the content is touched.
 */
export const anthropicProvider: Provider = {
  id: "anthropic",

  async embed(): Promise<EmbedResult> {
    throw new ProviderError(
      "anthropic",
      "Anthropic has no embeddings endpoint — set ATLAS_EMBEDDING_MODEL to a " +
        "Gemini or OpenAI embedding model.",
      { retryable: false },
    );
  },

  async complete(req: ChatRequest): Promise<ChatResult> {
    const started = performance.now();
    const spec = specFor(req.model);
    const res = await anthropic().messages.create(
      {
        model: req.model,
        max_tokens: Math.min(req.maxTokens, spec.maxOutput),
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.prompt }],
        ...(spec.supportsSampling && req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
        ...(req.jsonSchema
          ? {
              output_config: {
                format: { type: "json_schema", schema: req.jsonSchema },
              },
            }
          : {}),
      } as Anthropic.MessageCreateParamsNonStreaming,
      { signal: req.signal },
    );

    const stopReason = anthropicStop(res.stop_reason);
    // Guarded: on a refusal `content` is empty and indexing it would throw.
    const text =
      stopReason === "refusal"
        ? ""
        : res.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("")
            .trim();

    const inputTokens = res.usage.input_tokens;
    const outputTokens = res.usage.output_tokens;
    const cachedTokens = res.usage.cache_read_input_tokens ?? 0;

    return {
      text,
      stopReason,
      usage: {
        inputTokens,
        outputTokens,
        cachedTokens,
        costUsd: costOf(req.model, inputTokens, outputTokens, cachedTokens),
        ms: Math.round(performance.now() - started),
      },
    };
  },

  async *stream(req: ChatRequest): AsyncGenerator<string, StreamEnd, void> {
    const started = performance.now();
    const spec = specFor(req.model);
    const stream = anthropic().messages.stream(
      {
        model: req.model,
        max_tokens: Math.min(req.maxTokens, spec.maxOutput),
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: "user", content: req.prompt }],
        ...(spec.supportsSampling && req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
      } as Anthropic.MessageCreateParamsStreaming,
      { signal: req.signal },
    );

    for await (const event of stream) {
      if (req.signal?.aborted) break;
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }

    const final = await stream.finalMessage();
    const inputTokens = final.usage.input_tokens;
    const outputTokens = final.usage.output_tokens;
    const cachedTokens = final.usage.cache_read_input_tokens ?? 0;

    return {
      stopReason: anthropicStop(final.stop_reason),
      usage: {
        inputTokens,
        outputTokens,
        cachedTokens,
        costUsd: costOf(req.model, inputTokens, outputTokens, cachedTokens),
        ms: Math.round(performance.now() - started),
      },
    };
  },
};

export const PROVIDERS = {
  gemini: geminiProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
} as const;
