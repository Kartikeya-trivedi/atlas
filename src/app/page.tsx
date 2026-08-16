"use client";

import { useEffect, useRef } from "react";
import { Eraser, TriangleAlert } from "lucide-react";
import { Composer } from "@/components/chat/Composer";
import { MessageRow } from "@/components/chat/Message";
import { Inspector } from "@/components/retrieval/Inspector";
import { Button } from "@/components/ui/Controls";
import { useChat } from "@/hooks/useChat";
import { useConsole } from "@/lib/store";

export default function ConsolePage() {
  const { params, settings } = useConsole();
  const { messages, busy, send, stop, clear, lastTrace } = useChat(params, settings);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        {messages.length > 0 && (
          <div className="flex h-9 shrink-0 items-center justify-end border-b border-ink-800 px-3">
            <Button onClick={clear} variant="quiet">
              <Eraser size={10} strokeWidth={2} />
              clear thread
            </Button>
          </div>
        )}

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <Welcome onPick={send} />
          ) : (
            <>
              {messages.map((m) => (
                <MessageRow key={m.id} msg={m} />
              ))}
              <div ref={endRef} className="h-4" />
            </>
          )}
        </div>

        <Composer onSend={send} onStop={stop} busy={busy} />
      </div>

      <Inspector trace={lastTrace} />
    </div>
  );
}

function Welcome({ onPick }: { onPick: (q: string) => void }) {
  const { documents, health, corpusError } = useConsole();
  const ready = documents.filter((d) => d.stage === "ready");
  const blocked = health && !health.configured;
  const dbDown = health?.configured && !health.database.ok;

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col justify-center px-8 py-10">
      <div className="animate-rise">
        <h1 className="font-display text-[42px] leading-[1.05] text-bone-100">
          Two retrievers,
          <br />
          <em className="text-dense">one ranking.</em>
        </h1>
        <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-bone-400">
          Every question runs a Gemini embedding search and a Postgres keyword
          search at the same time. The two lists are fused by reciprocal rank,
          Gemini answers from the winners, and the inspector on the right shows
          you exactly which channel earned each passage.
        </p>
      </div>

      {blocked ? (
        <Notice title="Not configured yet">
          Set{" "}
          <code className="font-mono text-bone-200">{health.missing.join(", ")}</code>{" "}
          in <code className="font-mono text-bone-200">.env.local</code> and restart
          the dev server. See the README for the two-minute version.
        </Notice>
      ) : dbDown ? (
        <Notice title="Supabase is not answering">
          {health.database.ok ? null : health.database.error}
        </Notice>
      ) : corpusError ? (
        <Notice title="Could not load the corpus">{corpusError}</Notice>
      ) : ready.length === 0 ? (
        <Notice title="The corpus is empty">
          Drop a PDF, markdown file or text file into{" "}
          <a
            href="/corpus"
            className="text-dense underline decoration-dense/40 underline-offset-2 hover:decoration-dense"
          >
            corpus
          </a>{" "}
          and it will be extracted, chunked, embedded and indexed. Then ask
          something here.
        </Notice>
      ) : (
        <div className="animate-rise mt-9" style={{ animationDelay: "120ms" }}>
          <span className="label-micro">indexed and ready</span>
          <ul className="mt-2.5 space-y-px">
            {ready.slice(0, 4).map((doc, i) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => onPick(`What does “${doc.title}” cover?`)}
                  className="group flex w-full items-baseline gap-3 border-l-2 border-l-ink-700 py-2.5 pl-3 pr-2 text-left transition-all duration-200 hover:border-l-dense hover:bg-ink-850/60"
                  style={{ animationDelay: `${160 + i * 60}ms` }}
                >
                  <span className="tabular shrink-0 text-[10px] text-bone-600">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px] text-bone-200 transition-colors group-hover:text-bone-100">
                      {doc.title}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-snug text-bone-500">
                      {doc.chunkCount} chunks · {doc.tokenCount.toLocaleString()} tokens
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] leading-snug text-bone-500">
            Ask anything about them. Queries with identifiers or exact strings
            lean on the keyword channel; paraphrases lean on the vector one.
          </p>
        </div>
      )}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="animate-rise mt-9 border border-caution/35 bg-caution/[0.05] px-3.5 py-3"
      style={{ animationDelay: "120ms" }}
    >
      <p className="flex items-center gap-2 text-[12.5px] text-caution">
        <TriangleAlert size={13} className="shrink-0" strokeWidth={1.8} />
        {title}
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-bone-400">{children}</p>
    </div>
  );
}
