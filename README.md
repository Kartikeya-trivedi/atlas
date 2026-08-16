# popo

A hybrid-retrieval RAG console. Gemini for embeddings and generation, Supabase
Postgres (pgvector + tsvector) for storage and search.

Every question runs two retrievers at once — a dense vector search and a
Postgres full-text search — fuses the two ranked lists with weighted reciprocal
rank fusion, and answers from the winners with inline citations. The inspector
shows which channel earned each passage, which is the part most RAG demos hide.

## Why both channels

Dense retrieval fails on rare proper nouns, error codes, SKUs and version
strings: those tokens are poorly represented in embedding space. Keyword
retrieval fails on paraphrase, and on any question that shares no surface tokens
with the passage that answers it. Running both and fusing recovers the union.

RRF fuses *ranks*, not scores, which is what makes it safe to combine cosine
similarity with `ts_rank_cd` without normalising either one:

```
score(d) = α / (k + rank_dense) + (1 − α) / (k + rank_sparse)
```

## Setup

**1 — Supabase.** Create a project, then paste [`db/schema.sql`](db/schema.sql)
into the SQL editor and run it. It enables `vector`, creates `documents` and
`chunks`, builds the HNSW and GIN indexes, and defines the `hybrid_search()`
function the API calls. Re-running it is safe.

**2 — Environment.**

```bash
cp .env.example .env.local
```

Fill in `GEMINI_API_KEY` ([AI Studio](https://aistudio.google.com/apikey)),
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project
Settings → API).

**3 — Run.**

```bash
npm install && npm run dev
```

Open the app, go to **corpus**, drop in a PDF or markdown file, and wait for the
stage to reach `ready`. Then ask something on the console page. The settings
page reports whether the server is configured and how many chunks are indexed.

## Pipeline

| stage | what happens |
| --- | --- |
| extract | `unpdf` per page, `mammoth` for `.docx`, tag-stripping for HTML |
| chunk | structure-first — headings, then paragraphs, ~1400 chars, 12% overlap |
| contextualise | document title + heading path prepended before embedding |
| embed | `gemini-embedding-001`, `RETRIEVAL_DOCUMENT`, batches of 100 |
| index | HNSW on the vector, GIN on the generated tsvector |

Ingest runs in `after()`, so the upload POST returns as soon as the row exists
and the corpus table polls the `stage` and `progress` columns while the worker
does the slow part.

Query time: embed with `RETRIEVAL_QUERY` (a different task type — the same text
embeds differently, and mixing them degrades recall silently), one
`hybrid_search()` round trip, then stream the answer.

## Layout

```
db/schema.sql              tables, indexes, RLS, hybrid_search()
src/app/api/
  chat/                    retrieve + generate, NDJSON stream
  search/                  retrieval only, for the playground
  documents/               list, upload, delete
  health/                  configuration + connectivity
src/lib/server/            Gemini, Supabase, extract, chunk, search, prompt
src/lib/api.ts             the only thing the browser talks to
```

Nothing under `src/lib/server` is reachable from a client component — the
service role key and the Gemini key never enter the browser bundle.

## Knobs

The playground exposes every retrieval parameter live:

- **α** — channel weight. Toward keyword for identifiers and exact strings,
  toward vector for paraphrased questions.
- **top k** — passages that reach the model.
- **candidates** — rows pulled from *each* channel before fusion. Over-fetching
  lets a passage ranked 11th by one channel and 2nd by the other still win.
- **rrf k** — smoothing. Low values let one confident channel dominate.
- **min score** — cutoff. With strict grounding on, an empty result makes the
  model decline rather than improvise.
- **rerank** — a second Gemini pass that scores the query and each shortlisted
  passage jointly, then reorders. Costs a round trip.
- **query rewrite** — expands pronouns and follow-ups into standalone queries.
  Only fires when there is conversation history to resolve against.

## Notes

- `GEMINI_EMBED_DIM` must equal the `vector(N)` width in the schema. Changing
  one without the other fails at insert time. Changing it at all invalidates
  every stored vector — you have to alter the column and re-embed.
- Truncated Matryoshka outputs from `gemini-embedding-001` are not unit-length;
  they are normalised before storage.
- Upload cap is 20 MB. Scanned PDFs with no text layer are rejected with a
  message rather than silently indexed as empty.
- Ingesting a PDF prints `Warning: TypeError: Math.sumPrecise is not a function`
  a few dozen times. That is pdf.js feature-detecting a method Node does not
  have yet; it falls back internally and extraction is unaffected.
