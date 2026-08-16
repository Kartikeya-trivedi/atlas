"use client";

import { cx, score } from "@/lib/format";
import type { RetrievalParams, RetrievedChunk } from "@/lib/types";

/**
 * Contribution of each channel to a row's fused score, straight out of the
 * weighted-RRF definition. Kept next to the bar that draws it so the picture
 * can never drift from the maths.
 */
export function contributions(c: RetrievedChunk, p: RetrievalParams) {
  const d = c.denseRank ? p.alpha / (p.rrfK + c.denseRank) : 0;
  const s = c.sparseRank ? (1 - p.alpha) / (p.rrfK + c.sparseRank) : 0;
  const total = d + s;
  return { d, s, total, denseShare: total === 0 ? 0 : d / total };
}

/**
 * Bar LENGTH encodes the fused score. Bar COMPOSITION encodes which channel
 * earned it. A row that is entirely amber was found only by vector search; an
 * even split means both channels agreed.
 */
export function FusionBar({
  chunk,
  params,
  delay = 0,
}: {
  chunk: RetrievedChunk;
  params: RetrievalParams;
  delay?: number;
}) {
  const { denseShare } = contributions(chunk, params);
  const width = Math.max(0.02, chunk.fusedScore) * 100;

  return (
    <div className="flex h-[3px] w-full bg-ink-750">
      <div
        className="animate-sweep flex h-full"
        style={{ width: `${width}%`, animationDelay: `${delay}ms` }}
      >
        <div
          className="h-full"
          style={{
            width: `${denseShare * 100}%`,
            background: "var(--color-dense)",
            boxShadow: "0 0 6px color-mix(in oklab, var(--color-dense) 70%, transparent)",
          }}
        />
        <div
          className="h-full"
          style={{
            width: `${(1 - denseShare) * 100}%`,
            background: "var(--color-sparse)",
            boxShadow: "0 0 6px color-mix(in oklab, var(--color-sparse) 70%, transparent)",
          }}
        />
      </div>
    </div>
  );
}

/** Single-channel bar, used in the playground's per-channel columns. */
export function ChannelBar({
  value,
  channel,
  delay = 0,
}: {
  value: number;
  channel: "dense" | "sparse";
  delay?: number;
}) {
  const color = channel === "dense" ? "var(--color-dense)" : "var(--color-sparse)";
  return (
    <div className="h-[3px] w-full bg-ink-750">
      <div
        className="animate-sweep h-full"
        style={{
          width: `${Math.max(0.02, value) * 100}%`,
          background: color,
          boxShadow: `0 0 6px color-mix(in oklab, ${color} 70%, transparent)`,
          animationDelay: `${delay}ms`,
        }}
      />
    </div>
  );
}

/**
 * Rank chips. An em-dash in either slot is the interesting case — it means
 * exactly one channel found this passage, which is the whole argument for
 * hybrid search.
 */
export function RankPair({
  chunk,
  className,
}: {
  chunk: RetrievedChunk;
  className?: string;
}) {
  const cell = (
    label: string,
    rank: number | null,
    val: number | null,
    color: string,
  ) => (
    <span
      className="tabular inline-flex items-baseline gap-1 text-[10.5px]"
      title={
        rank === null
          ? `${label}: not retrieved by this channel`
          : `${label}: rank ${rank}, score ${score(val)}`
      }
    >
      <span className="label-micro !text-[9px]" style={{ color }}>
        {label}
      </span>
      <span className={rank === null ? "text-bone-600" : "text-bone-300"}>
        {rank === null ? "——" : `#${rank}`}
      </span>
      <span className={rank === null ? "text-bone-600" : "text-bone-500"}>
        {score(val)}
      </span>
    </span>
  );

  return (
    <div className={cx("flex items-center gap-3", className)}>
      {cell("VEC", chunk.denseRank, chunk.denseScore, "var(--color-dense)")}
      <span className="h-2.5 w-px bg-ink-600" />
      {cell("KEY", chunk.sparseRank, chunk.sparseScore, "var(--color-sparse)")}
    </div>
  );
}

/** Legend explaining the two-colour system. Shown once per view. */
export function ChannelLegend({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center gap-3", className)}>
      <span className="label-micro flex items-center gap-1.5">
        <span className="h-[3px] w-4 bg-dense" />
        vector
      </span>
      <span className="label-micro flex items-center gap-1.5">
        <span className="h-[3px] w-4 bg-sparse" />
        keyword
      </span>
    </div>
  );
}
