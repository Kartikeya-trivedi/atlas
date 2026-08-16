import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DocumentRecord } from "@/lib/types";
import { serverConfig } from "./env";

/**
 * Service-role client. Server-only — this key bypasses row level security, so
 * it must never reach the browser. Nothing under src/lib/server is imported
 * from a "use client" module; the route handlers are the boundary.
 */

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;
  const cfg = serverConfig();
  cached = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "popo" } },
  });
  return cached;
}

/** Row shapes as stored. camelCase conversion happens at the route boundary. */
export interface DocumentRow {
  id: string;
  tenant_id: string;
  title: string;
  kind: "pdf" | "md" | "txt" | "html" | "docx";
  size_bytes: number;
  stage:
    | "queued"
    | "extracting"
    | "chunking"
    | "embedding"
    | "indexing"
    | "ready"
    | "failed";
  progress: number;
  chunk_count: number;
  token_count: number;
  error: string | null;
  created_at: string;
}

/** Storage row -> the camelCase shape the UI renders. */
export function toDocumentRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    sizeBytes: Number(row.size_bytes),
    chunkCount: row.chunk_count ?? 0,
    tokenCount: row.token_count ?? 0,
    stage: row.stage,
    progress: row.progress ?? 0,
    addedAt: Date.parse(row.created_at),
    error: row.error ?? undefined,
  };
}

export interface SearchRow {
  chunk_id: string;
  document_id: string;
  document_title: string;
  ordinal: number;
  page: number | null;
  heading: string | null;
  content: string;
  dense_score: number | null;
  sparse_score: number | null;
  fused_score: number;
  dense_rank: number | null;
  sparse_rank: number | null;
  dense_ms: number;
  sparse_ms: number;
  fuse_ms: number;
}

/**
 * pgvector accepts its text input form over PostgREST. Sending a raw JS array
 * lands as a JSON array and fails to cast, so stringify explicitly.
 */
export function toVectorLiteral(embedding: number[]): string {
  return JSON.stringify(embedding);
}
