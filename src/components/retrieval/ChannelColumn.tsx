"use client";

import { cx, score } from "@/lib/format";
import { useConsole } from "@/lib/store";
import type { RetrievedChunk } from "@/lib/types";
import { ChannelBar, FusionBar, RankPair } from "./ScoreBar";

/**
 * One ranked list. In the fused column the rows also carry a delta showing how
 * far each passage moved relative to its position in the given reference
 * channel — that movement is the clearest evidence of what fusion actually did.
 */
export function ChannelColumn({
  title,
  subtitle,
  variant,
  rows,
  emptyNote,
  onSelect,
  selected,
}: {
  title: string;
  subtitle: string;
  variant: "dense" | "sparse" | "fused";
  rows: RetrievedChunk[];
  emptyNote: string;
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  const { params } = useConsole();

  const accent =
    variant === "dense"
      ? "var(--color-dense)"
      : variant === "sparse"
        ? "var(--color-sparse)"
        : "var(--color-bone-100)";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-ink-700 last:border-r-0">
      <header className="shrink-0 border-b border-ink-700 px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="h-[3px] w-5 shrink-0" style={{ background: accent }} />
          <h2
            className="font-display text-[15px] leading-none"
            style={{ color: accent }}
          >
            {title}
          </h2>
          <span className="tabular ml-auto text-[10.5px] text-bone-600">
            {rows.length}
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-bone-500">{subtitle}</p>
      </header>

      <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <li className="px-3 py-8 text-center text-[11.5px] leading-relaxed text-bone-600">
            {emptyNote}
          </li>
        ) : (
          rows.map((c, i) => {
            const isSel = selected === c.chunkId;

            // Movement relative to this row's rank in the opposite-side list.
            const refRank =
              variant === "fused"
                ? null
                : variant === "dense"
                  ? c.denseRank
                  : c.sparseRank;
            const delta =
              variant === "fused" || refRank === null ? null : refRank - (i + 1);

            return (
              <li key={c.chunkId}>
                <button
                  type="button"
                  onClick={() => onSelect(c.chunkId)}
                  className={cx(
                    "w-full border-b border-ink-800 border-l-2 px-3 py-2.5 text-left transition-colors duration-150",
                    isSel
                      ? "border-l-bone-200 bg-ink-800"
                      : "border-l-transparent hover:border-l-ink-500 hover:bg-ink-850/70",
                  )}
                >
                  <div className="flex items-baseline gap-2">
                    <span
                      className="tabular w-4 shrink-0 text-[10px]"
                      style={{ color: i < 3 ? accent : "var(--color-bone-600)" }}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-bone-200">
                      {c.documentTitle}
                    </span>
                    <span className="tabular shrink-0 text-[10.5px] text-bone-400">
                      {score(
                        variant === "dense"
                          ? c.denseScore
                          : variant === "sparse"
                            ? c.sparseScore
                            : c.fusedScore,
                      )}
                    </span>
                  </div>

                  <p className="mt-1 line-clamp-2 pl-6 text-[11.5px] leading-snug text-bone-500">
                    {c.content}
                  </p>

                  <div className="mt-2 pl-6">
                    {variant === "fused" ? (
                      <FusionBar chunk={c} params={params} delay={i * 40} />
                    ) : (
                      <ChannelBar
                        value={
                          (variant === "dense" ? c.denseScore : c.sparseScore) ?? 0
                        }
                        channel={variant}
                        delay={i * 40}
                      />
                    )}

                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <RankPair chunk={c} />
                      {delta !== null && delta !== 0 && (
                        <span
                          className={cx(
                            "tabular shrink-0 text-[10px]",
                            delta > 0 ? "text-signal" : "text-alert",
                          )}
                          title={`Moved ${Math.abs(delta)} place${
                            Math.abs(delta) === 1 ? "" : "s"
                          } ${delta > 0 ? "up" : "down"} after fusion`}
                        >
                          {delta > 0 ? "▲" : "▼"}
                          {Math.abs(delta)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}
