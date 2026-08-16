/**
 * Shared contracts.
 *
 * These mirror the shapes the Postgres side will return so the mock layer and
 * the real `/api` routes stay swappable. Notably `RetrievedChunk` is exactly
 * one row of the `hybrid_search()` RPC described in db/schema.sql.
 */

export type Channel = "dense" | "sparse";

/** One row out of hybrid_search(). */
export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  /** 0-based ordinal of the chunk inside its parent document. */
  ordinal: number;
  content: string;
  page?: number;

  /** Cosine similarity, 0..1. Null when the row was found only by keyword. */
  denseScore: number | null;
  /** ts_rank_cd, normalised 0..1. Null when found only by vector. */
  sparseScore: number | null;
  /** Reciprocal-rank-fusion score — the value actually used for ordering. */
  fusedScore: number;

  /** Rank within each channel before fusion, 1-based. Null = absent. */
  denseRank: number | null;
  sparseRank: number | null;
}

/** Everything the inspector needs to explain one retrieval. */
export interface RetrievalTrace {
  query: string;
  /** The query after LLM rewriting, when rewrite is enabled. */
  rewrittenQuery?: string;
  params: RetrievalParams;
  dense: RetrievedChunk[];
  sparse: RetrievedChunk[];
  fused: RetrievedChunk[];
  timings: {
    embedMs: number;
    denseMs: number;
    sparseMs: number;
    fuseMs: number;
    rerankMs?: number;
    generateMs?: number;
  };
  /** Tokens of context actually handed to Gemini after the budget cut. */
  contextTokens: number;
}

export interface RetrievalParams {
  /** 0 = pure keyword, 1 = pure vector. Weighted RRF. */
  alpha: number;
  /** Rows returned to the model after fusion. */
  topK: number;
  /** Rows pulled from *each* channel before fusion. */
  candidates: number;
  /** RRF smoothing constant; 60 is the value from the original paper. */
  rrfK: number;
  /** Drop fused rows below this. 0 disables. */
  minScore: number;
  rerank: boolean;
  rewriteQuery: boolean;
}

export const DEFAULT_PARAMS: RetrievalParams = {
  alpha: 0.5,
  topK: 8,
  candidates: 40,
  rrfK: 60,
  minScore: 0,
  rerank: false,
  rewriteQuery: true,
};

export type MessageRole = "user" | "assistant";

export interface Citation {
  /** 1-based marker rendered inline as [1], [2] ... */
  marker: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  page?: number;
  snippet: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  /** Assistant only. */
  citations?: Citation[];
  trace?: RetrievalTrace;
  /** True while tokens are still arriving. */
  streaming?: boolean;
  error?: string;
}

export type IngestStage =
  | "queued"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "ready"
  | "failed";

export const INGEST_STAGES: IngestStage[] = [
  "queued",
  "extracting",
  "chunking",
  "embedding",
  "indexing",
  "ready",
];

export interface DocumentRecord {
  id: string;
  title: string;
  /** Source file extension, drives the glyph in the table. */
  kind: "pdf" | "md" | "txt" | "html" | "docx";
  sizeBytes: number;
  chunkCount: number;
  tokenCount: number;
  stage: IngestStage;
  /** 0..1, only meaningful while stage is embedding/indexing. */
  progress: number;
  addedAt: number;
  error?: string;
}

export interface ModelSettings {
  generationModel: string;
  embeddingModel: string;
  embeddingDim: number;
  temperature: number;
  maxOutputTokens: number;
  systemPrompt: string;
  /** Refuse to answer when fusion returns nothing above minScore. */
  strictGrounding: boolean;
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  generationModel: "gemini-2.0-flash",
  embeddingModel: "gemini-embedding-001",
  embeddingDim: 768,
  temperature: 0.2,
  maxOutputTokens: 2048,
  systemPrompt:
    "You answer strictly from the provided context. Cite every claim with the bracketed chunk marker it came from. If the context does not contain the answer, say so plainly rather than guessing.",
  strictGrounding: true,
};
