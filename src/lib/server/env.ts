/**
 * Server-side configuration.
 *
 * Read lazily rather than at module load: `next build` evaluates every route
 * module, and a missing key should surface as a 503 with an actionable message
 * at request time, not as a build failure on a machine that has no .env.local.
 */

export class ConfigError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(
      `Missing environment ${missing.length === 1 ? "variable" : "variables"}: ${missing.join(
        ", ",
      )}. Copy .env.example to .env.local and fill them in.`,
    );
    this.name = "ConfigError";
    this.missing = missing;
  }
}

export interface ServerConfig {
  geminiApiKey: string;
  generationModel: string;
  embedModel: string;
  embedDim: number;
  supabaseUrl: string;
  serviceRoleKey: string;
  /** Single-tenant by default; the schema is multi-tenant so this can grow. */
  tenantId: string;
  topK: number;
  rrfK: number;
  alpha: number;
}

const REQUIRED = [
  "GEMINI_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/** Stable fallback so the multi-tenant columns have something to hold. */
const DEFAULT_TENANT = "00000000-0000-0000-0000-000000000001";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Throws ConfigError when anything required is absent. */
export function serverConfig(): ServerConfig {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  if (missing.length) throw new ConfigError([...missing]);

  return {
    geminiApiKey: process.env.GEMINI_API_KEY!.trim(),
    generationModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
    embedModel: process.env.GEMINI_EMBED_MODEL?.trim() || "gemini-embedding-001",
    embedDim: num("GEMINI_EMBED_DIM", 768),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    tenantId: process.env.POPO_TENANT_ID?.trim() || DEFAULT_TENANT,
    topK: num("RAG_TOP_K", 8),
    rrfK: num("RAG_RRF_K", 60),
    alpha: num("RAG_ALPHA", 0.5),
  };
}

/** Non-throwing variant for the health endpoint and the settings screen. */
export function configStatus() {
  const missing = REQUIRED.filter((k) => !process.env[k]?.trim());
  return {
    configured: missing.length === 0,
    missing: [...missing],
    generationModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
    embedModel: process.env.GEMINI_EMBED_MODEL?.trim() || "gemini-embedding-001",
    embedDim: num("GEMINI_EMBED_DIM", 768),
  };
}
