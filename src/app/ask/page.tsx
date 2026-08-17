"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Inspector } from "@/components/Inspector";
import {
  ApiError,
  DEFAULT_PARAMS,
  chatStream,
  formatMs,
  type Citation,
  type RetrievalTrace,
} from "@/lib/api";

interface Turn {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  trace?: RetrievalTrace | null;
  note?: string | null;
  cost?: number;
}

const EXAMPLES = [
  "What changed in the authentication system in the last three releases?",
  "Where do we still reference the deprecated /v1/auth endpoint?",
  "Why did checkout failures increase after v4.2?",
];

export default function AskPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTrace, setOpenTrace] = useState<RetrievalTrace | null>(null);

  const abort = useRef<AbortController | null>(null);
  const tail = useRef<HTMLDivElement>(null);

  // Follow the stream, but only while the reader is already at the bottom —
  // yanking the viewport away from someone reading an earlier answer is worse
  // than not following at all.
  useEffect(() => {
    const el = tail.current;
    const scroller = el?.parentElement?.parentElement;
    if (!el || !scroller) return;
    const nearBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 220;
    if (nearBottom) el.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;

      setError(null);
      setDraft("");
      setBusy(true);

      const history = turns.map((t) => ({ role: t.role, content: t.content }));
      setTurns((prev) => [
        ...prev,
        { role: "user", content: q },
        { role: "assistant", content: "" },
      ]);

      const controller = new AbortController();
      abort.current = controller;

      const patch = (fn: (t: Turn) => Turn) =>
        setTurns((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) next[next.length - 1] = fn(last);
          return next;
        });

      try {
        for await (const frame of chatStream({
          query: q,
          history,
          params: DEFAULT_PARAMS,
          signal: controller.signal,
        })) {
          if (frame.type === "trace") {
            patch((t) => ({ ...t, trace: frame.trace }));
            setOpenTrace(frame.trace);
          } else if (frame.type === "delta") {
            patch((t) => ({ ...t, content: t.content + frame.text }));
          } else if (frame.type === "done") {
            patch((t) => ({
              ...t,
              content: frame.content || t.content,
              citations: frame.citations,
              note: frame.error ?? null,
              cost: frame.cost_usd,
            }));
          } else {
            setError(frame.error);
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          patch((t) => ({ ...t, note: "Stopped." }));
        } else {
          setError(err instanceof ApiError ? err.message : "Something went wrong.");
          // Drop the empty assistant turn so the transcript does not keep a
          // blank bubble where an answer never arrived.
          setTurns((prev) =>
            prev[prev.length - 1]?.content === "" ? prev.slice(0, -1) : prev,
          );
        }
      } finally {
        abort.current = null;
        setBusy(false);
      }
    },
    [busy, turns],
  );

  const empty = turns.length === 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
        <div>
          <h1 className="text-[0.9rem] font-medium tracking-[-0.015em]">Ask</h1>
          <p className="text-2xs text-ink-ghost">
            Grounded in your corpus, cited per claim
          </p>
        </div>
        {!empty && (
          <button
            type="button"
            onClick={() => {
              setTurns([]);
              setOpenTrace(null);
              setError(null);
            }}
            className="btn"
          >
            Clear
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[46rem] px-6 py-8">
              {empty ? (
                <Welcome onPick={ask} />
              ) : (
                <div className="flex flex-col gap-7">
                  {turns.map((turn, i) => (
                    <Bubble
                      key={i}
                      turn={turn}
                      streaming={busy && i === turns.length - 1}
                      onOpenTrace={setOpenTrace}
                    />
                  ))}
                </div>
              )}
              {error && (
                <div className="fade mt-6 rounded-[9px] border border-[rgba(217,83,79,0.28)] bg-[rgba(217,83,79,0.07)] px-3.5 py-2.5">
                  <p className="text-xs leading-relaxed text-[#e8a19e]">{error}</p>
                </div>
              )}
              <div ref={tail} />
            </div>
          </div>

          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={() => void ask(draft)}
            onStop={() => abort.current?.abort()}
            busy={busy}
          />
        </section>

        <aside className="hidden w-[27rem] shrink-0 overflow-y-auto border-l border-line bg-[rgba(9,10,13,0.4)] p-4 xl:block">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="label">Retrieval trace</span>
            {openTrace && (
              <span className="num text-2xs text-ink-ghost">
                {formatMs(openTrace.timings.total_ms)}
              </span>
            )}
          </div>
          <Inspector trace={openTrace} />
        </aside>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── welcome ── */

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="flex flex-col items-start pt-10">
      <div
        className="rise h-[3px] w-16 rounded-full"
        style={{
          background:
            "linear-gradient(90deg, var(--color-dense), var(--color-lexical))",
        }}
      />
      <h2 className="rise d1 mt-5 text-[1.6rem] font-semibold leading-[1.2] tracking-[-0.03em]">
        Two retrievers,
        <br />
        one answer you can audit.
      </h2>
      <p className="rise d2 mt-3 max-w-md text-sm leading-relaxed text-ink-dim">
        A vector search finds what you meant. A keyword search finds what you
        typed. Every claim below carries the passage it came from, and the trace
        shows which channel earned it.
      </p>

      <div className="mt-8 flex w-full flex-col gap-1.5">
        <span className="rise d3 label mb-1">Try</span>
        {EXAMPLES.map((example, i) => (
          <button
            key={example}
            type="button"
            onClick={() => onPick(example)}
            className={`rise d${i + 3} group flex items-center gap-2.5 rounded-[8px] border border-line bg-surface px-3.5 py-2.5 text-left text-sm text-ink-dim transition-all duration-150 hover:border-line-strong hover:bg-raised hover:text-ink`}
          >
            <span className="h-1 w-1 shrink-0 rounded-full bg-ink-ghost transition-colors group-hover:bg-accent" />
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── bubble ── */

function Bubble({
  turn,
  streaming,
  onOpenTrace,
}: {
  turn: Turn;
  streaming: boolean;
  onOpenTrace: (t: RetrievalTrace | null) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="rise flex justify-end">
        <p className="max-w-[85%] rounded-[11px] rounded-br-[4px] border border-line-strong bg-raised px-3.5 py-2.5 text-sm">
          {turn.content}
        </p>
      </div>
    );
  }

  return (
    <div className="rise flex flex-col gap-3">
      <div className="text-base leading-[1.7] text-ink">
        <Prose text={turn.content} citations={turn.citations} />
        {streaming && <span className="caret" />}
      </div>

      {turn.note && <p className="text-2xs text-warn">{turn.note}</p>}

      {turn.citations && turn.citations.length > 0 && (
        <Sources citations={turn.citations} />
      )}

      {!streaming && turn.trace && (
        <button
          type="button"
          onClick={() => onOpenTrace(turn.trace ?? null)}
          className="flex items-center gap-2 self-start text-2xs text-ink-ghost transition-colors hover:text-ink-dim"
        >
          <span
            className="h-[3px] w-8 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, var(--color-dense), var(--color-lexical))",
            }}
          />
          {turn.trace.fused.length} passages ·{" "}
          {formatMs(turn.trace.timings.total_ms)}
          {turn.cost != null && turn.cost > 0 && ` · $${turn.cost.toFixed(4)}`}
        </button>
      )}
    </div>
  );
}

/**
 * Renders the answer with [n] markers turned into clickable chips.
 *
 * Markers with no matching citation are left visible and coloured as an error
 * rather than silently swallowed: a model that writes [7] when six passages
 * were retrieved should be obviously wrong, not quietly tidied up.
 */
function Prose({ text, citations }: { text: string; citations?: Citation[] }) {
  if (!text) return null;
  const byMarker = new Map((citations ?? []).map((c) => [c.marker, c]));

  return (
    <>
      {text.split(/(\[\d{1,2}\])/g).map((part, i) => {
        const match = /^\[(\d{1,2})\]$/.exec(part);
        if (!match) {
          return (
            <span key={i} className="whitespace-pre-wrap">
              {part}
            </span>
          );
        }
        const marker = Number(match[1]);
        const citation = byMarker.get(marker);
        if (!citation) {
          return (
            <span key={i} className="text-danger" title="No such passage">
              {part}
            </span>
          );
        }
        return (
          <a
            key={i}
            href={`#cite-${marker}`}
            className="cite"
            title={`${citation.document_title}${citation.page ? ` · p.${citation.page}` : ""}`}
          >
            {marker}
          </a>
        );
      })}
    </>
  );
}

function Sources({ citations }: { citations: Citation[] }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <span className="label">Sources</span>
      {citations.map((c) => (
        <div
          key={c.marker}
          id={`cite-${c.marker}`}
          className="flex scroll-mt-6 gap-2.5 rounded-[7px] border border-line bg-surface px-2.5 py-2"
        >
          <span className="cite mt-px shrink-0 cursor-default">{c.marker}</span>
          <div className="min-w-0">
            <p className="truncate text-xs text-ink">
              {c.document_title}
              {c.page != null && (
                <span className="num ml-1.5 text-ink-ghost">p.{c.page}</span>
              )}
            </p>
            <p className="mt-0.5 line-clamp-2 text-2xs leading-snug text-ink-faint">
              {c.snippet}
            </p>
          </div>
          {c.document_uri && (
            <a
              href={c.document_uri}
              target="_blank"
              rel="noreferrer"
              className="ml-auto shrink-0 self-center text-2xs text-ink-ghost transition-colors hover:text-accent"
            >
              open ↗
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────── composer ── */

function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to a ceiling, then scroll. Reset the height first,
  // or the box can only ever get taller.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  return (
    <div className="shrink-0 border-t border-line bg-[rgba(9,10,13,0.6)] px-6 py-4 backdrop-blur-xl">
      <div className="mx-auto w-full max-w-[46rem]">
        <div className="flex items-end gap-2 rounded-[11px] border border-line-strong bg-void p-2 transition-colors focus-within:border-accent">
          <textarea
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter breaks — the convention for a box that
              // is usually one line and occasionally several.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit();
              }
            }}
            placeholder="Ask your corpus…"
            className="max-h-[168px] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-ghost"
          />
          {busy ? (
            <button type="button" onClick={onStop} className="btn shrink-0">
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!value.trim()}
              className="btn btn-primary shrink-0"
            >
              Ask
            </button>
          )}
        </div>
        <p className="mt-2 text-center text-2xs text-ink-ghost">
          Answers are grounded in your corpus. Every claim carries the passage it
          came from.
        </p>
      </div>
    </div>
  );
}
