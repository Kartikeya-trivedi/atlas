import { z } from "zod";

/**
 * Configuration, read lazily and validated once.
 *
 * Lazy because `next build` evaluates every route module: a missing key should
 * surface as a 503 with an actionable message at request time, not as a build
 * failure on a machine that has no .env.local.
 */

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(
      `Invalid configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}\n\n` +
        `Copy .env.example to .env.local and fill it in.`,
    );
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const numeric = (fallback: number) =>
  z.coerce.number().catch(fallback).default(fallback);

const Schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_MAX: numeric(10),

  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  ATLAS_GENERATION_MODEL: z.string().default("gemini-2.5-flash"),
  ATLAS_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  ATLAS_EMBEDDING_DIM: numeric(768),
  ATLAS_EMBEDDING_VERSION: numeric(1),

  ATLAS_SESSION_SECRET: z.string().optional(),
  ATLAS_DEV_USER: z.string().optional(),

  ATLAS_TOP_K: numeric(8),
  ATLAS_CANDIDATES: numeric(60),
  ATLAS_ALPHA: numeric(0.5),
  ATLAS_RRF_K: numeric(60),

  ATLAS_MAX_ROUNDS: numeric(4),
  ATLAS_MAX_TOOL_CALLS: numeric(8),
  ATLAS_MAX_QUERY_TOKENS: numeric(120_000),
  ATLAS_MAX_QUERY_COST_USD: numeric(0.25),
  ATLAS_MAX_QUERY_MS: numeric(90_000),

  ATLAS_WORKER_CONCURRENCY: numeric(4),
  ATLAS_WORKER_POLL_MS: numeric(1000),
  ATLAS_JOB_LEASE_SECONDS: numeric(300),

  GITHUB_TOKEN: z.string().optional(),
  NOTION_TOKEN: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  JIRA_BASE_URL: z.string().optional(),
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof Schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  cached = parsed.data;
  return cached;
}

/** Non-throwing variant for the health endpoint and the settings screen. */
export function envStatus(): {
  ok: boolean;
  issues: string[];
  providers: { gemini: boolean; openai: boolean; anthropic: boolean };
  generationModel: string;
  embeddingModel: string;
  embeddingDim: number;
} {
  const parsed = Schema.safeParse(process.env);
  const e = parsed.success ? parsed.data : null;
  return {
    ok: parsed.success,
    issues: parsed.success
      ? []
      : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    providers: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    generationModel: e?.ATLAS_GENERATION_MODEL ?? "gemini-2.5-flash",
    embeddingModel: e?.ATLAS_EMBEDDING_MODEL ?? "gemini-embedding-001",
    embeddingDim: e?.ATLAS_EMBEDDING_DIM ?? 768,
  };
}

/** Test seam: forget the memoised value after mutating process.env. */
export function resetEnv(): void {
  cached = null;
}
