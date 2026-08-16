"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Search } from "lucide-react";
import { ChannelColumn } from "@/components/retrieval/ChannelColumn";
import { FusionControls } from "@/components/retrieval/FusionControls";
import { Button } from "@/components/ui/Controls";
import { Panel } from "@/components/ui/Panel";
import { useSearch } from "@/hooks/useSearch";
import { useConsole } from "@/lib/store";

/**
 * Retrieval without generation. The point of this view is the disagreement
 * between the two columns on the outside, and what fusion in the middle does
 * about it. Results re-fetch on a short debounce as you type or move a slider,
 * so the controls still feel connected to the ranking.
 */
export default function PlaygroundPage() {
  const { params, resetParams, documents } = useConsole();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { trace, loading, error } = useSearch(query, params);

  // Real document titles rather than canned examples — a title is a query the
  // corpus is guaranteed to have something to say about.
  const suggestions = useMemo(
    () =>
      documents
        .filter((d) => d.stage === "ready")
        .slice(0, 5)
        .map((d) => d.title),
    [documents],
  );

  const only = useMemo(() => {
    const inDense = new Set(trace.dense.map((c) => c.chunkId));
    const inSparse = new Set(trace.sparse.map((c) => c.chunkId));
    return {
      denseOnly: trace.dense.filter((c) => !inSparse.has(c.chunkId)).length,
      sparseOnly: trace.sparse.filter((c) => !inDense.has(c.chunkId)).length,
    };
  }, [trace]);

  return (
    <div className="flex h-full min-h-0">
      {/* ---- controls ---- */}
      <Panel
        label="fusion parameters"
        className="w-[268px] shrink-0 border-y-0 border-l-0"
        scroll
        aside={
          <Button onClick={resetParams} variant="quiet" title="Reset to defaults">
            <RotateCcw size={10} strokeWidth={2} />
          </Button>
        }
      >
        <div className="p-3.5">
          <FusionControls />
        </div>

        <div className="border-t border-ink-800 p-3.5">
          <span className="label-micro">disagreement</span>
          <dl className="mt-2 space-y-1.5">
            <Row k="vector only" v={only.denseOnly} color="var(--color-dense)" />
            <Row k="keyword only" v={only.sparseOnly} color="var(--color-sparse)" />
            <Row
              k="context tokens"
              v={trace.contextTokens}
              color="var(--color-bone-300)"
            />
          </dl>
          <p className="mt-2.5 text-[11px] leading-snug text-bone-500">
            Passages only one channel found. If this is always zero, hybrid
            search is not earning its cost on this corpus.
          </p>
        </div>

        <div className="border-t border-ink-800 p-3.5">
          <span className="label-micro">latency</span>
          <dl className="mt-2 space-y-1.5">
            <Row k="embed query" v={trace.timings.embedMs} color="var(--color-bone-400)" unit="ms" />
            <Row k="vector scan" v={trace.timings.denseMs} color="var(--color-dense)" unit="ms" />
            <Row k="keyword scan" v={trace.timings.sparseMs} color="var(--color-sparse)" unit="ms" />
            <Row k="fuse" v={trace.timings.fuseMs} color="var(--color-bone-300)" unit="ms" />
          </dl>
        </div>
      </Panel>

      {/* ---- query + columns ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-ink-700 bg-ink-850/50 px-4 py-3">
          <div className="flex items-center gap-2.5 border border-ink-600 bg-ink-800 px-3 py-2 transition-colors focus-within:border-dense/60">
            {loading ? (
              <Loader2 size={13} className="shrink-0 animate-spin text-dense" strokeWidth={1.8} />
            ) : (
              <Search size={13} className="shrink-0 text-bone-500" strokeWidth={1.8} />
            )}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type a query — results re-rank as you type"
              className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-bone-100 placeholder:text-bone-600 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="label-micro shrink-0 hover:!text-bone-200"
              >
                clear
              </button>
            )}
          </div>

          {suggestions.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="label-micro !text-[8.5px]">from your corpus</span>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setQuery(s)}
                  title={s}
                  className={`label-micro max-w-[220px] truncate border px-2 py-1 transition-colors ${
                    s === query
                      ? "border-dense/50 !text-dense"
                      : "border-ink-700 hover:border-ink-500 hover:!text-bone-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11.5px] text-bone-500">
              Nothing indexed yet — add documents in{" "}
              <a
                href="/corpus"
                className="text-dense underline decoration-dense/40 underline-offset-2 hover:decoration-dense"
              >
                corpus
              </a>
              .
            </p>
          )}

          {error && (
            <p className="mt-2 flex items-start gap-2 border border-alert/35 bg-alert/5 px-2.5 py-1.5 text-[11.5px] leading-snug text-alert">
              <AlertTriangle size={12} className="mt-[2px] shrink-0" strokeWidth={1.8} />
              {error}
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          <ChannelColumn
            title="vector"
            subtitle="cosine over gemini-embedding-001 · pgvector HNSW"
            variant="dense"
            rows={trace.dense}
            emptyNote={
              query.trim()
                ? "Nothing. Either the corpus is empty, or no chunk is close to this query in embedding space."
                : "No query."
            }
            onSelect={setSelected}
            selected={selected}
          />
          <ChannelColumn
            title="fused"
            subtitle={`weighted RRF · α=${params.alpha.toFixed(2)} · k=${params.rrfK}`}
            variant="fused"
            rows={trace.fused}
            emptyNote="Nothing above the score cutoff."
            onSelect={setSelected}
            selected={selected}
          />
          <ChannelColumn
            title="keyword"
            subtitle="ts_rank_cd over tsvector · GIN"
            variant="sparse"
            rows={trace.sparse}
            emptyNote={
              query.trim()
                ? "No lexical overlap with the corpus — nothing here shares a token with the query. Whatever fusion returns came from vector alone."
                : "No query."
            }
            onSelect={setSelected}
            selected={selected}
          />
        </div>
      </div>
    </div>
  );
}

function Row({
  k,
  v,
  color,
  unit,
}: {
  k: string;
  v: number;
  color: string;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="label-micro">{k}</dt>
      <dd className="tabular text-[12px]" style={{ color }}>
        {v.toLocaleString()}
        {unit ? <span className="ml-0.5 text-bone-600">{unit}</span> : null}
      </dd>
    </div>
  );
}
