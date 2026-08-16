"use client";

import { Fragment, useState } from "react";
import { AlertTriangle, FileText, Quote } from "lucide-react";
import { cx } from "@/lib/format";
import type { Citation, Message as Msg } from "@/lib/types";

/**
 * Splits assistant text on [n] markers and swaps each one for an interactive
 * chip. Any marker without a matching citation is left as literal text rather
 * than silently dropped — a dangling marker is a grounding bug worth seeing.
 */
function withCitations(
  text: string,
  citations: Citation[] | undefined,
  onHover: (id: string | null) => void,
  active: string | null,
) {
  if (!citations?.length) return text;
  const byMarker = new Map(citations.map((c) => [c.marker, c]));

  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    const cite = byMarker.get(Number(m[1]));
    if (!cite) return <Fragment key={i}>{part}</Fragment>;

    const isActive = active === cite.chunkId;
    return (
      <button
        key={i}
        type="button"
        onMouseEnter={() => onHover(cite.chunkId)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(cite.chunkId)}
        onBlur={() => onHover(null)}
        title={`${cite.documentTitle}${cite.page ? ` · p.${cite.page}` : ""}`}
        className={cx(
          "tabular mx-[1px] inline-flex h-[15px] min-w-[15px] translate-y-[-1px] items-center justify-center border px-[3px] align-middle text-[9.5px] leading-none transition-all duration-150",
          isActive
            ? "border-dense bg-dense text-ink-900"
            : "border-dense/40 text-dense hover:border-dense hover:bg-dense/15",
        )}
      >
        {cite.marker}
      </button>
    );
  });
}

export function MessageRow({ msg }: { msg: Msg }) {
  const [active, setActive] = useState<string | null>(null);

  if (msg.role === "user") {
    return (
      <div className="animate-rise px-5 py-4">
        <div className="flex gap-3">
          <span className="label-micro mt-[5px] shrink-0 !text-dense">you</span>
          <p className="min-w-0 flex-1 text-[14.5px] leading-relaxed text-bone-100">
            {msg.content}
          </p>
        </div>
      </div>
    );
  }

  const showRetrieving = msg.streaming && !msg.content;

  return (
    <div className="animate-rise border-t border-ink-800 px-5 py-4">
      <div className="flex gap-3">
        <span className="label-micro mt-[5px] shrink-0">popo</span>

        <div className="min-w-0 flex-1">
          {showRetrieving ? (
            <RetrievingIndicator hasTrace={Boolean(msg.trace)} />
          ) : (
            <div
              className={cx(
                "whitespace-pre-wrap text-[14.5px] leading-[1.72] text-bone-200",
                msg.streaming && "stream-caret",
              )}
            >
              {withCitations(msg.content, msg.citations, setActive, active)}
            </div>
          )}

          {msg.error && (
            <p className="mt-3 flex items-start gap-2 border border-alert/35 bg-alert/5 px-3 py-2 text-[12.5px] text-alert">
              <AlertTriangle size={14} className="mt-[2px] shrink-0" strokeWidth={1.8} />
              {msg.error}
            </p>
          )}

          {!msg.streaming && msg.citations && msg.citations.length > 0 && (
            <Sources
              citations={msg.citations}
              active={active}
              onHover={setActive}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RetrievingIndicator({ hasTrace }: { hasTrace: boolean }) {
  const steps = ["embedding query", "searching both channels", "fusing ranks"];
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-full bg-dense"
            style={{
              animation: "pulse-dot 1.1s ease-in-out infinite",
              animationDelay: `${i * 0.16}s`,
            }}
          />
        ))}
      </span>
      <span className="label-micro">{hasTrace ? steps[2] : steps[0]}</span>
    </div>
  );
}

function Sources({
  citations,
  active,
  onHover,
}: {
  citations: Citation[];
  active: string | null;
  onHover: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="label-micro flex items-center gap-1.5 hover:!text-bone-200"
      >
        <Quote size={10} strokeWidth={2} />
        {citations.length} source{citations.length === 1 ? "" : "s"}
        <span className="text-bone-600">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <ul className="mt-2.5 space-y-px">
          {citations.map((c) => (
            <li
              key={c.chunkId}
              onMouseEnter={() => onHover(c.chunkId)}
              onMouseLeave={() => onHover(null)}
              className={cx(
                "animate-rise border-l-2 py-2 pl-3 pr-2 transition-colors duration-150",
                active === c.chunkId
                  ? "border-l-dense bg-dense/[0.06]"
                  : "border-l-ink-600 hover:border-l-bone-600",
              )}
            >
              <div className="flex items-baseline gap-2">
                <span className="tabular text-[10px] text-dense">
                  [{c.marker}]
                </span>
                <FileText size={11} className="translate-y-[1px] text-bone-500" strokeWidth={1.7} />
                <span className="truncate text-[12px] text-bone-300">
                  {c.documentTitle}
                </span>
                {c.page && (
                  <span className="tabular shrink-0 text-[10.5px] text-bone-600">
                    p.{c.page}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-bone-500">
                {c.snippet}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
