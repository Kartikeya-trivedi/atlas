-- ============================================================================
-- popo — hybrid retrieval schema  (Gemini embeddings + Supabase / pgvector)
--
-- Apply with:  supabase db push   (or paste the whole file into the SQL editor)
-- Re-running is safe: every object is dropped or guarded before creation.
--
-- The API routes call hybrid_search() with exactly these arguments and read
-- exactly these columns. src/lib/server/search.ts is the only caller.
-- ============================================================================

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- tables ---

create table if not exists documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  title         text not null,
  kind          text not null check (kind in ('pdf','md','txt','html','docx')),
  size_bytes    bigint not null default 0,
  stage         text not null default 'queued'
                check (stage in ('queued','extracting','chunking','embedding',
                                 'indexing','ready','failed')),
  progress      real not null default 0,
  chunk_count   int  not null default 0,
  token_count   int  not null default 0,
  error         text,
  created_at    timestamptz not null default now()
);

-- Older installs predate the counters; the ingest worker writes them.
alter table documents add column if not exists chunk_count int not null default 0;
alter table documents add column if not exists token_count int not null default 0;

-- NOTE: vector(768) must match GEMINI_EMBED_DIM. Changing one without the
-- other fails at insert time with a dimension mismatch.
--
-- `heading` holds the breadcrumb the ingester prepends (document title + the
-- heading path above the chunk). It is kept out of `content` so the citation
-- snippet stays clean, but folded into `fts` and into the embedded text so
-- both retrieval channels can see it. A chunk reading "the limit is 100 per
-- request" is nearly meaningless without it.
create table if not exists chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references documents(id) on delete cascade,
  tenant_id     uuid not null,
  ordinal       int  not null,
  page          int,
  heading       text,
  content       text not null,
  token_count   int  not null default 0,
  embedding     vector(768),

  -- Generated, so the lexical index can never drift from the content.
  fts           tsvector generated always as
                  (to_tsvector('english', coalesce(heading, '') || ' ' || content))
                  stored,

  created_at    timestamptz not null default now(),
  unique (document_id, ordinal)
);

-- --------------------------------------------------------------- indexes ---

-- Build AFTER bulk load. Incremental HNSW construction is several times slower.
create index if not exists chunks_embedding_hnsw
  on chunks using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists chunks_fts_gin
  on chunks using gin (fts);

-- tenant_id leading so the planner can use it as a prefix filter.
create index if not exists chunks_tenant_doc
  on chunks (tenant_id, document_id);

create index if not exists documents_tenant_created
  on documents (tenant_id, created_at desc);

-- ------------------------------------------------------------------ rls ---
-- Every read and write goes through the Next.js route handlers using the
-- service role key, which bypasses RLS. These policies therefore only matter
-- if you later expose the tables to the anon key directly — at which point
-- they deny everything until the JWT carries a tenant_id claim.

alter table documents enable row level security;
alter table chunks    enable row level security;

drop policy if exists documents_tenant_isolation on documents;
drop policy if exists chunks_tenant_isolation    on chunks;

create policy documents_tenant_isolation on documents
  for all using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

create policy chunks_tenant_isolation on chunks
  for all using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ================================================================ search ===
-- Weighted reciprocal rank fusion, computed in-database so only the final
-- shortlist crosses the wire.
--
--   score(d) = alpha / (rrf_k + rank_dense)  +  (1-alpha) / (rrf_k + rank_sparse)
--
-- RRF combines *ranks*, not scores, which is what makes it safe to fuse cosine
-- distance and ts_rank_cd without normalising either one.
--
-- The two channels run as separate statements rather than as CTEs of one query
-- so each can be timed independently — the inspector draws a real flame chart,
-- not an estimate. Two index scans either way.
-- ===========================================================================

-- Row shape passed between the stages inside the function.
do $$ begin
  create type popo_hit as (id uuid, score float, rnk int);
exception when duplicate_object then null;
end $$;

do $$ begin
  create type popo_fused_hit as (
    id uuid, ds float, ss float, dr int, sr int, fs float
  );
exception when duplicate_object then null;
end $$;

-- Adding parameters to an existing function creates an overload, and the next
-- call becomes ambiguous. Drop every signature first.
do $$
declare r record;
begin
  for r in
    select oid::regprocedure as sig
    from pg_proc
    where proname = 'hybrid_search' and pronamespace = 'public'::regnamespace
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create function hybrid_search(
  query_text        text,
  query_embedding   vector(768),
  match_count       int     default 8,      -- rows returned after fusion
  candidate_count   int     default 40,     -- rows pulled from EACH channel
  alpha             float   default 0.5,    -- 1 = pure vector, 0 = pure keyword
  rrf_k             int     default 60,
  min_score         float   default 0,
  filter_tenant     uuid    default null,
  filter_documents  uuid[]  default null,
  ef_search         int     default 100,
  -- true  -> return the whole union of both candidate lists, unfiltered, so the
  --          caller can render the per-channel columns and normalise scores
  -- false -> return just the fused top-k above min_score
  with_candidates   boolean default false
)
returns table (
  chunk_id       uuid,
  document_id    uuid,
  document_title text,
  ordinal        int,
  page           int,
  heading        text,
  content        text,
  dense_score    float,
  sparse_score   float,
  fused_score    float,
  dense_rank     int,
  sparse_rank    int,
  dense_ms       float,
  sparse_ms      float,
  fuse_ms        float
)
language plpgsql
-- search_path pinned: an unqualified reference must never resolve into a
-- caller-controlled schema.
set search_path = public, pg_temp
as $$
declare
  dense_hits  popo_hit[];
  sparse_hits popo_hit[];
  fused_hits  popo_fused_hit[];
  tsq         tsquery;
  t0 timestamptz; t1 timestamptz; t2 timestamptz; t3 timestamptz;
  d_ms float; s_ms float; f_ms float;
begin
  -- Per-query recall knob for HNSW. Must be >= the number of rows fetched or
  -- the graph walk stops early and quietly returns fewer good candidates.
  perform set_config('hnsw.ef_search',
                     greatest(ef_search, candidate_count)::text,
                     true);   -- local: reverts at end of transaction

  tsq := websearch_to_tsquery('english', coalesce(query_text, ''));

  -- ---------------------------------------------------- channel 1: vector ---
  -- The LIMIT is applied in the inner subquery and row_number() only in the
  -- outer one. Ranking before limiting would force a sort of every matching
  -- row — window functions are evaluated before ORDER BY / LIMIT — and the
  -- HNSW index would go unused on exactly the query it exists for.
  t0 := clock_timestamp();
  select coalesce(array_agg((q.id, q.score, q.rnk)::popo_hit), '{}'::popo_hit[])
    into dense_hits
  from (
    select t.id,
           t.score,
           (row_number() over (order by t.distance))::int as rnk
    from (
      select c.id,
             (c.embedding <=> query_embedding)          as distance,
             (1 - (c.embedding <=> query_embedding))::float as score
      from chunks c
      where c.embedding is not null
        and (filter_tenant    is null or c.tenant_id   =     filter_tenant)
        and (filter_documents is null or c.document_id = any(filter_documents))
      order by c.embedding <=> query_embedding
      limit candidate_count
    ) t
  ) q;
  t1 := clock_timestamp();
  d_ms := extract(epoch from (t1 - t0)) * 1000;

  -- --------------------------------------------------- channel 2: keyword ---
  -- Normalisation flag 32 is rank/(rank+1), which bounds ts_rank_cd into 0..1
  -- so the UI can plot it on the same axis as cosine similarity.
  select coalesce(array_agg((q.id, q.score, q.rnk)::popo_hit), '{}'::popo_hit[])
    into sparse_hits
  from (
    select t.id,
           t.score,
           (row_number() over (order by t.score desc))::int as rnk
    from (
      select c.id,
             ts_rank_cd(c.fts, tsq, 32)::float as score
      from chunks c
      where c.fts @@ tsq
        and (filter_tenant    is null or c.tenant_id   =     filter_tenant)
        and (filter_documents is null or c.document_id = any(filter_documents))
      order by ts_rank_cd(c.fts, tsq, 32) desc
      limit candidate_count
    ) t
  ) q;
  t2 := clock_timestamp();
  s_ms := extract(epoch from (t2 - t1)) * 1000;

  -- ------------------------------------------------------------- fusion ----
  -- FULL OUTER JOIN, so a passage found by only one channel still competes;
  -- its missing term contributes zero rather than disqualifying the row.
  select coalesce(
           array_agg((x.id, x.ds, x.ss, x.dr, x.sr, x.fs)::popo_fused_hit
                     order by x.fs desc),
           '{}'::popo_fused_hit[])
    into fused_hits
  from (
    select coalesce(d.id, s.id) as id,
           d.score as ds,
           s.score as ss,
           d.rnk   as dr,
           s.rnk   as sr,
           (coalesce(alpha / (rrf_k + d.rnk), 0) +
            coalesce((1 - alpha) / (rrf_k + s.rnk), 0))::float as fs
    from unnest(dense_hits) d
    full outer join unnest(sparse_hits) s on d.id = s.id
  ) x;
  t3 := clock_timestamp();
  f_ms := extract(epoch from (t3 - t2)) * 1000;

  return query
  select c.id,
         c.document_id,
         doc.title,
         c.ordinal,
         c.page,
         c.heading,
         c.content,
         f.ds, f.ss, f.fs, f.dr, f.sr,
         d_ms, s_ms, f_ms
  from unnest(fused_hits) f
  join chunks    c   on c.id     = f.id
  join documents doc on doc.id   = c.document_id
  where f.fs >= (case when with_candidates then 0::float else min_score end)
  order by f.fs desc
  limit (case when with_candidates then candidate_count * 2 else match_count end);
end;
$$;

-- The route handlers authenticate as service_role; nothing else may search.
revoke all on function hybrid_search from public, anon, authenticated;
grant execute on function hybrid_search to service_role;
