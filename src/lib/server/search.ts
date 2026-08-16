import type { RetrievalParams, RetrievalTrace, RetrievedChunk } from "@/lib/types";
import { serverConfig } from "./env";
import { embedQuery, rerankPassages } from "./gemini";
import { db, toVectorLiteral, type SearchRow } from "./supabase";

/** Server-side view of a hit; `heading` is used to build the prompt context. */
export interface ServerChunk extends RetrievedChunk {
  heading: string | null;
}

export interface ServerTrace extends RetrievalTrace {
  fused: ServerChunk[];
  dense: ServerChunk[];
  sparse: ServerChunk[];
}

export interface SearchOptions {
  query: string;
  params: RetrievalParams;
  /** Standalone rewrite, when the caller produced one. Embedded instead of `query`. */
  rewrittenQuery?: string;
  /** Restrict to a subset of the corpus. */
  documentIds?: string[];
  /** Model used for the reranker, when params.rerank is on. */
  generationModel: string;
  signal?: AbortSignal;
}

/**
 * One hybrid_search() round trip, shaped into the trace the inspector renders.
 *
 * The RPC is asked for the whole union of both candidate lists rather than just
 * the fused top-k. That is what lets the playground show the two channels
 * disagreeing — and the fused score has to be normalised against the strongest
 * hit in the union, since raw RRF sums land around 0.008 and the min-score
 * cutoff is expressed on a 0..1 scale.
 */
export async function hybridSearch(opts: SearchOptions): Promise<ServerTrace> {
  const { params } = opts;
  const searchText = (opts.rewrittenQuery || opts.query).trim();

  const empty: ServerTrace = {
    query: opts.query,
    rewrittenQuery: opts.rewrittenQuery,
    params,
    dense: [],
    sparse: [],
    fused: [],
    timings: { embedMs: 0, denseMs: 0, sparseMs: 0, fuseMs: 0 },
    contextTokens: 0,
  };
  if (!searchText) return empty;

  // --- embed the question ---------------------------------------------------
  const tEmbed = performance.now();
  const embedding = await embedQuery(searchText);
  const embedMs = Math.round(performance.now() - tEmbed);

  // Over-fetching below topK would silently truncate the fusion input.
  const candidates = Math.max(params.candidates, params.topK, 10);

  const { data, error } = await db().rpc("hybrid_search", {
    query_text: searchText,
    query_embedding: toVectorLiteral(embedding),
    match_count: params.topK,
    candidate_count: candidates,
    alpha: params.alpha,
    rrf_k: params.rrfK,
    min_score: 0,
    filter_tenant: serverConfig().tenantId,
    filter_documents: opts.documentIds?.length ? opts.documentIds : null,
    ef_search: Math.max(100, candidates),
    with_candidates: true,
  });

  if (error) {
    throw new Error(
      `hybrid_search failed: ${error.message}. ` +
        `Has db/schema.sql been applied to this project?`,
    );
  }

  const rows = (data ?? []) as SearchRow[];
  if (rows.length === 0) return { ...empty, timings: { ...empty.timings, embedMs } };

  // Raw RRF sums are tiny and depend on rrfK; the UI plots 0..1.
  const maxFused = Math.max(...rows.map((r) => r.fused_score), Number.EPSILON);

  const build = (r: SearchRow): ServerChunk => ({
    chunkId: r.chunk_id,
    documentId: r.document_id,
    documentTitle: r.document_title,
    ordinal: r.ordinal,
    content: r.content,
    heading: r.heading,
    page: r.page ?? undefined,
    denseScore: r.dense_score,
    sparseScore: r.sparse_score,
    fusedScore: r.fused_score / maxFused,
    denseRank: r.dense_rank,
    sparseRank: r.sparse_rank,
  });

  const all = rows.map(build);
  const columnDepth = Math.max(params.topK, 10);

  const dense = all
    .filter((c) => c.denseRank !== null)
    .sort((a, b) => a.denseRank! - b.denseRank!)
    .slice(0, columnDepth);

  const sparse = all
    .filter((c) => c.sparseRank !== null)
    .sort((a, b) => a.sparseRank! - b.sparseRank!)
    .slice(0, columnDepth);

  let fused = all
    .filter((c) => c.fusedScore >= params.minScore)
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, params.topK);

  // --- optional rerank ------------------------------------------------------
  let rerankMs: number | undefined;
  if (params.rerank && fused.length > 1) {
    const tRerank = performance.now();
    const scores = await rerankPassages(
      opts.generationModel,
      searchText,
      fused.map((c) => `${c.heading ? `${c.heading}\n` : ""}${c.content}`),
      opts.signal,
    );
    if (scores) {
      // Reorder only. The fused score keeps its meaning in the inspector, and
      // overwriting it would make the bar chart disagree with the RRF maths
      // drawn next to it.
      fused = fused
        .map((c, i) => ({ chunk: c, relevance: scores[i] }))
        .sort((a, b) => b.relevance - a.relevance || b.chunk.fusedScore - a.chunk.fusedScore)
        .map((x) => x.chunk);
    }
    rerankMs = Math.round(performance.now() - tRerank);
  }

  const first = rows[0];
  return {
    query: opts.query,
    rewrittenQuery: opts.rewrittenQuery,
    params,
    dense,
    sparse,
    fused,
    timings: {
      embedMs,
      denseMs: Math.round(first.dense_ms ?? 0),
      sparseMs: Math.round(first.sparse_ms ?? 0),
      fuseMs: Math.max(1, Math.round(first.fuse_ms ?? 0)),
      rerankMs,
    },
    contextTokens: fused.reduce(
      (sum, c) => sum + Math.ceil((c.content.length + (c.heading?.length ?? 0)) / 4),
      0,
    ),
  };
}
