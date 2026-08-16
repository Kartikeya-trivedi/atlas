import {
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_PARAMS,
  type RetrievalParams,
} from "@/lib/types";
import { serverConfig } from "./env";
import { resolveGenerationModel } from "./gemini";
import { bool, clamp } from "./http";

/**
 * Request bodies come from a UI full of sliders, so every field is clamped to
 * the same range the control allows. The alternative is a NaN reaching a SQL
 * parameter or a six-figure topK pulling the whole corpus into a prompt.
 */

export function parseParams(raw: unknown): RetrievalParams {
  const p = (raw ?? {}) as Record<string, unknown>;
  const cfg = serverConfig();

  const topK = clamp(p.topK, 1, 20, cfg.topK);
  return {
    alpha: clamp(p.alpha, 0, 1, cfg.alpha),
    topK,
    // Fusing fewer candidates than we intend to keep would silently truncate.
    candidates: clamp(p.candidates, topK, 100, Math.max(DEFAULT_PARAMS.candidates, topK)),
    rrfK: clamp(p.rrfK, 1, 120, cfg.rrfK),
    minScore: clamp(p.minScore, 0, 0.99, DEFAULT_PARAMS.minScore),
    rerank: bool(p.rerank, DEFAULT_PARAMS.rerank),
    rewriteQuery: bool(p.rewriteQuery, DEFAULT_PARAMS.rewriteQuery),
  };
}

export interface GenerationSettings {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  systemPrompt: string;
  strictGrounding: boolean;
}

export function parseGenerationSettings(raw: unknown): GenerationSettings {
  const s = (raw ?? {}) as Record<string, unknown>;
  const systemPrompt =
    typeof s.systemPrompt === "string" && s.systemPrompt.trim()
      ? s.systemPrompt.slice(0, 4_000)
      : DEFAULT_MODEL_SETTINGS.systemPrompt;

  return {
    // Allowlisted server-side; an unknown id falls back to GEMINI_MODEL.
    model: resolveGenerationModel(
      typeof s.generationModel === "string" ? s.generationModel : undefined,
    ),
    temperature: clamp(s.temperature, 0, 1, DEFAULT_MODEL_SETTINGS.temperature),
    maxOutputTokens: clamp(
      s.maxOutputTokens,
      256,
      8_192,
      DEFAULT_MODEL_SETTINGS.maxOutputTokens,
    ),
    systemPrompt,
    strictGrounding: bool(s.strictGrounding, DEFAULT_MODEL_SETTINGS.strictGrounding),
  };
}

export function parseQuery(raw: unknown): string {
  const q = typeof raw === "string" ? raw.trim() : "";
  return q.slice(0, 4_000);
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export function parseHistory(raw: unknown): HistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-10)
    .filter(
      (m): m is HistoryTurn =>
        typeof m === "object" &&
        m !== null &&
        (m as HistoryTurn).role !== undefined &&
        typeof (m as HistoryTurn).content === "string",
    )
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content.slice(0, 2_000),
    }));
}
