"use client";

import { useState } from "react";
import { Layers, RotateCcw } from "lucide-react";
import { compact, cx, score } from "@/lib/format";
import { useConsole } from "@/lib/store";
import type { RetrievalTrace, RetrievedChunk } from "@/lib/types";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Controls";
import { ChannelLegend, FusionBar, RankPair, contributions } from "./ScoreBar";
import { FusionControls } from "./FusionControls";

export function Inspector({ trace }: { trace?: RetrievalTrace }) {
  const [tab, setTab] = useState<"trace" | "tune">("trace");
  const { resetParams } = useConsole();

  return (
    <Panel
      label="retrieval inspector"
      className="w-[380px] shrink-0 border-y-0 border-r-0"
      aside={
        <div className="flex items-center gap-1">
          {(["trace", "tune"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cx(
                "label-micro px-1.5 py-1 transition-colors",
                tab === t ? "!text-bone-100" : "hover:!text-bone-300",
              )}
            >
              {t}
              {tab === t && <span className="mt-1 block h-px bg-dense" />}
            </button>
          ))}
        </div>
      }
      scroll
      bodyClassName="scroll-thin"
    >
      {tab === "tune" ? (
        <div className="p-3.5">
          <FusionControls />
          <div className="mt-5 flex justify-end border-t border-ink-800 pt-3">
            <Button onClick={resetParams} variant="quiet">
              <RotateCcw size={10} strokeWidth={2} />
              reset defaults
            </Button>
          </div>
        </div>
      ) : trace ? (
        <TraceView trace={trace} />
      ) : (
        <EmptyTrace />
      )}
    </Panel>
  );
}

function EmptyTrace() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Layers size={20} className="text-bone-600" strokeWidth={1.4} />
      <p className="text-[12.5px] leading-relaxed text-bone-500">
        Ask something and the full retrieval path lands here — both channels,
        their ranks, and how fusion resolved the disagreement.
      </p>
    </div>
  );
}

function TraceView({ trace }: { trace: RetrievalTrace }) {
  const bothCount = trace.fused.filter(
    (c) => c.denseRank !== null && c.sparseRank !== null,
  ).length;
  const denseOnly = trace.fused.filter((c) => c.sparseRank === null).length;
  const sparseOnly = trace.fused.filter((c) => c.denseRank === null).length;

  return (
    <div className="divide-y divide-ink-800">
      <div className="px-3.5 py-3">
        <span className="label-micro">query</span>
        <p className="mt-1 font-mono text-[12px] leading-relaxed text-bone-200">
          {trace.query}
        </p>
      </div>

      <Timings trace={trace} />

      <div className="px-3.5 py-3">
        <div className="flex items-center justify-between">
          <span className="label-micro">channel overlap</span>
          <span className="tabular text-[11px] text-bone-400">
            {trace.fused.length} kept
          </span>
        </div>
        <Overlap
          both={bothCount}
          denseOnly={denseOnly}
          sparseOnly={sparseOnly}
        />
        <p className="mt-2 text-[11.5px] leading-snug text-bone-500">
          {bothCount === 0
            ? "No passage was found by both channels — fusion is doing all the work here."
            : `${bothCount} passage${bothCount === 1 ? "" : "s"} found independently by both channels.`}
        </p>
      </div>

      <div className="px-3.5 py-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="label-micro">fused context</span>
          <ChannelLegend />
        </div>
        <ol className="space-y-px">
          {trace.fused.map((c, i) => (
            <ChunkRow key={c.chunkId} chunk={c} index={i} />
          ))}
        </ol>
        <p className="mt-3 flex items-center justify-between border-t border-ink-800 pt-2.5">
          <span className="label-micro">context sent</span>
          <span className="tabular text-[11px] text-bone-300">
            ~{compact(trace.contextTokens)} tok
          </span>
        </p>
      </div>
    </div>
  );
}

/** Mini flame chart of the request. Widths are true to the millisecond values. */
function Timings({ trace }: { trace: RetrievalTrace }) {
  const t = trace.timings;
  const segs = [
    { label: "embed", ms: t.embedMs, color: "var(--color-bone-500)" },
    { label: "vector", ms: t.denseMs, color: "var(--color-dense)" },
    { label: "keyword", ms: t.sparseMs, color: "var(--color-sparse)" },
    { label: "fuse", ms: t.fuseMs, color: "var(--color-bone-300)" },
    ...(t.rerankMs
      ? [{ label: "rerank", ms: t.rerankMs, color: "var(--color-caution)" }]
      : []),
    ...(t.generateMs
      ? [{ label: "generate", ms: t.generateMs, color: "var(--color-signal)" }]
      : []),
  ];
  const total = segs.reduce((s, x) => s + x.ms, 0);

  return (
    <div className="px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <span className="label-micro">latency</span>
        <span className="tabular text-[11px] text-bone-300">{total} ms</span>
      </div>

      <div className="mt-2 flex h-[5px] w-full gap-px overflow-hidden">
        {segs.map((s) => (
          <div
            key={s.label}
            title={`${s.label} · ${s.ms}ms`}
            className="animate-sweep h-full"
            style={{ width: `${(s.ms / total) * 100}%`, background: s.color }}
          />
        ))}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1">
        {segs.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span
              className="h-[2px] w-2.5 shrink-0"
              style={{ background: s.color }}
            />
            <span className="label-micro !text-[8.5px] truncate">{s.label}</span>
            <span className="tabular ml-auto text-[10px] text-bone-500">
              {s.ms}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Overlap({
  both,
  denseOnly,
  sparseOnly,
}: {
  both: number;
  denseOnly: number;
  sparseOnly: number;
}) {
  const total = Math.max(1, both + denseOnly + sparseOnly);
  const seg = (n: number, bg: string, title: string) =>
    n > 0 ? (
      <div
        title={title}
        className="animate-sweep flex h-full items-center justify-center"
        style={{ width: `${(n / total) * 100}%`, background: bg }}
      >
        <span className="tabular text-[9px] text-ink-900">{n}</span>
      </div>
    ) : null;

  return (
    <div className="mt-2 flex h-4 w-full gap-px bg-ink-750">
      {seg(denseOnly, "var(--color-dense)", `${denseOnly} vector-only`)}
      {seg(both, "var(--color-bone-200)", `${both} found by both`)}
      {seg(sparseOnly, "var(--color-sparse)", `${sparseOnly} keyword-only`)}
    </div>
  );
}

function ChunkRow({ chunk, index }: { chunk: RetrievedChunk; index: number }) {
  const [open, setOpen] = useState(false);
  const { params } = useConsole();
  const { denseShare } = contributions(chunk, params);

  const origin =
    chunk.denseRank === null
      ? "keyword only"
      : chunk.sparseRank === null
        ? "vector only"
        : `${Math.round(denseShare * 100)}% vector`;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="group w-full border-l-2 border-l-transparent py-2 pl-2.5 pr-1 text-left transition-colors hover:border-l-ink-500 hover:bg-ink-800/60"
      >
        <div className="flex items-baseline gap-2">
          <span className="tabular w-4 shrink-0 text-[10px] text-bone-600">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-bone-200">
            {chunk.documentTitle}
          </span>
          <span className="tabular shrink-0 text-[10.5px] text-bone-500">
            {score(chunk.fusedScore)}
          </span>
        </div>

        <div className="mt-1.5 pl-6">
          <FusionBar chunk={chunk} params={params} delay={index * 45} />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <RankPair chunk={chunk} />
            <span className="label-micro !text-[8.5px] shrink-0">{origin}</span>
          </div>
        </div>
      </button>

      {open && (
        <p className="animate-rise ml-6 mb-2 border-l border-ink-700 py-1 pl-3 pr-2 text-[11.5px] leading-relaxed text-bone-400">
          {chunk.content}
          <span className="label-micro mt-1.5 block">
            chunk {chunk.ordinal}
            {chunk.page ? ` · page ${chunk.page}` : ""} · {chunk.chunkId}
          </span>
        </p>
      )}
    </li>
  );
}
