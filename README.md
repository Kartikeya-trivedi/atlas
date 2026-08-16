# Atlas

Permission-aware hybrid retrieval over a multi-source corpus.

Two retrievers run on every question — a dense vector search and a BM25 lexical
search — fused with weighted reciprocal rank fusion, answered with inline
citations. The debugger shows which channel earned each passage, which is the
part most RAG systems hide.

The differentiator is not the chatbot. It is that retrieval is *inspectable*,
permissions are enforced *before ranking*, and ingestion is *durable*.

---

## Why both channels

Dense retrieval fails on rare proper nouns, error codes, SKUs and version
strings: those tokens are poorly represented in embedding space. Lexical
retrieval fails on paraphrase, and on any question sharing no surface tokens with
the passage that answers it. Running both and fusing recovers the union.

RRF fuses *ranks*, not scores, which is what makes it safe to combine cosine
similarity with BM25 without normalising either into the other's units:

```
score(d) = α / (k + rank_dense) + (1 − α) / (k + rank_lexical)
```

The lexical channel is **real BM25**, not `ts_rank_cd`. `ts_rank_cd` has no IDF
and no document-length normalisation, so it rewards long chunks and treats a
match on "the" like a match on `AUTH-381`. IDF is computed at query time from one
GIN probe per query lexeme — few probes, always exact — rather than from a
term-frequency table that has to be maintained on every write.

## Permissions are not a post-filter

`acl_groups` is denormalised from documents onto chunks, and the predicate
`(is_admin or acl_public or acl_groups && $user_groups)` sits **inside both
channel scans**. Filtering after ranking would let an inaccessible chunk consume
a slot in the shortlist and silently reduce recall for the rows the user *can*
see. There is no path through `hybrid_search()` that ranks a row the caller may
not read.

Seed the demo tenant and ask the same question as `alice@acme.test` and
`carol@acme.test`: different corpora, same query, visible in the trace.

---

## Layout

```
db/migrations/     numbered SQL — the schema is the source of truth
api/               FastAPI service: ingestion, retrieval, workers
  atlas/
    config.py      settings, read once
    db.py          asyncpg pool
    repo.py        every query, one module
    llm/           provider abstraction (Gemini / OpenAI / Anthropic)
    ingest/        extract -> chunk -> hash -> pipeline
    jobs/          Postgres queue + worker process
    connectors/    upload, web, GitHub
    retrieval/     hybrid search, rerank, context, citations
    routers/       the HTTP surface
  scripts/         migrate.py, seed.py
src/               Next.js frontend (chat, corpus, debugger)
```

## Setup

**1 — Supabase.** Create a project. The migrations enable `vector`, `pg_trgm`
and `pgcrypto` themselves.

**2 — Environment.**

```bash
cp .env.example .env.local
```

Fill in `DATABASE_URL` (Supabase → Settings → Database → URI, **session pooler on
port 5432**), one provider key, and `ATLAS_SESSION_SECRET`.

> The transaction pooler on 6543 cannot hold the migrator's advisory lock and
> breaks the job queue's `SELECT … FOR UPDATE SKIP LOCKED`. Use 5432.

**3 — Backend.**

```bash
cd api && python -m venv .venv && .venv/Scripts/activate && pip install -e ".[dev]"
```

**4 — Migrate and seed.**

```bash
cd api && python -m scripts.migrate && python -m scripts.seed
```

**5 — Run.** Three processes:

```bash
cd api && uvicorn atlas.main:app --reload --port 8000
```

```bash
cd api && python -m atlas.jobs.worker
```

```bash
npm install && npm run dev
```

API docs at `http://localhost:8000/docs`; `GET /health` reports which half of
the configuration is wrong when something is.

---

## Pipeline

| stage | what happens |
| --- | --- |
| extract | `pypdf` per page, `python-docx` for `.docx`, tag-stripping for HTML |
| chunk | type-aware — prose by heading, code by symbol, chat by thread |
| contextualise | breadcrumb (`repo/auth.py › class TokenService › def refresh`) folded into the embedded text *and* the tsvector |
| embed | batched, halving on failure, task-typed `RETRIEVAL_DOCUMENT` |
| index | HNSW on the vector, GIN on the generated tsvector and on `acl_groups` |

Ingestion runs in a **worker**, not in the request. The upload endpoint writes
the document row, the blob and the job in one transaction and returns; the worker
claims it with `SKIP LOCKED`, renews a lease while it works, and retries with
exponential backoff and jitter on failure.

**Nothing is re-embedded unnecessarily.** Each document stores a content hash and
three pipeline versions. Equal hash and equal versions means the re-sync is a
no-op. Same text with a new embedding model means the vectors are recomputed in
place without re-chunking. That is the difference between a repository sync
costing cents and costing hundreds of dollars.

## Knobs

Every retrieval parameter is live on `POST /search`:

- **α** — channel weight. Toward lexical for identifiers and exact strings,
  toward vector for paraphrased questions.
- **top k** — passages that reach the model.
- **candidates** — rows pulled from *each* channel before fusion. Over-fetching
  lets a passage ranked 11th by one channel and 2nd by the other still win.
- **rrf k** — smoothing. Low values let one confident channel dominate.
- **min score** — cutoff. With strict grounding on, an empty result makes the
  model decline rather than improvise.
- **rerank** — a second pass scoring query and passage jointly, then reordering.
  Reorder only: the fused score keeps its meaning in the debugger.
- **query rewrite** — expands pronouns and follow-ups into standalone queries.
  Only fires when there is history to resolve against.

## Providers

Nothing above `atlas/llm` names a vendor. The provider is inferred from the model
id, and `registry.py` records what each model costs and what it refuses to
accept — `supports_sampling` is load-bearing, because Anthropic removed
`temperature`/`top_p`/`top_k` on Opus 4.7 and later and sending one returns a 400
rather than being ignored.

Prices are USD per million tokens and overridable at runtime with
`ATLAS_PRICE_OVERRIDES`, so a vendor price change is a config edit rather than a
deploy.

---

## Status

Built and compiling:

- Schema: tenancy, ACLs, sources, documents, chunks, jobs, eval tables, trace
  tables (6 migrations)
- BM25 + dense + weighted RRF with the permission predicate inside both scans
- `find_mentions()` — exhaustive literal lookup grouped by source, for
  "everywhere we still reference `/v1/auth`"
- Provider abstraction with a cost table, retry, and usage accounting
- Type-aware chunking (prose / code / conversation) with breadcrumbs
- Incremental indexing via content hash + parser/chunker/embedding versions
- Durable queue, leases, backoff, dead letter, crash reclamation
- Connectors: upload, web, GitHub (single-call tree walk, commit-sha cursor)
- Chat with NDJSON streaming, trace-before-tokens, citation extraction

Scaffolded but not yet built — the schema is in place, the code is not:

- **Evaluation harness** (tables exist in `004_eval.sql`). This is the next thing
  worth building: every knob above is currently tunable and unfalsifiable, and
  the before/after numbers that would justify any of this cannot be written
  without it.
- **Groundedness validator** — claim extraction and per-claim support checking
- **Trace persistence** — `005_observability.sql` defines the tables; the writer
  is not wired up, so cost and p95 are per-request only
- **Query planning / agentic retrieval** — budget caps are in `config.py`, the
  loop is not written
- Notion, Slack, Jira connectors
- Frontend beyond the Next.js scaffold

No end-to-end run has happened yet: it compiles, but nothing has been executed
against a live Supabase project or a real provider key.
