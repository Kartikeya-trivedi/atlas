"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  api,
  formatBytes,
  type CorpusCounts,
  type DocumentRow,
  type Stage,
} from "@/lib/api";

/** Ingest stages, in pipeline order. Drives the progress rail on each row. */
const STAGES: Stage[] = [
  "queued",
  "extracting",
  "chunking",
  "embedding",
  "indexing",
  "ready",
];

const LIVE: Stage[] = [
  "queued",
  "fetching",
  "extracting",
  "chunking",
  "embedding",
  "indexing",
];

export default function CorpusPage() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [counts, setCounts] = useState<CorpusCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.documents();
      setDocs(res.documents);
      setCounts(res.counts);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the corpus.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while something is actually moving through the pipeline. A table
  // of finished documents does not need a heartbeat.
  useEffect(() => {
    const busy = docs.some((d) => LIVE.includes(d.stage));
    if (!busy && uploading === 0) return;
    const id = setInterval(() => void load(), 1200);
    return () => clearInterval(id);
  }, [docs, uploading, load]);

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      setUploading((n) => n + list.length);
      setError(null);
      for (const file of list) {
        try {
          await api.upload(file);
        } catch (err) {
          setError(
            err instanceof ApiError
              ? `${file.name}: ${err.message}`
              : `${file.name}: upload failed.`,
          );
        } finally {
          setUploading((n) => n - 1);
        }
      }
      void load();
    },
    [load],
  );

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6">
        <div>
          <h1 className="text-[0.9rem] font-medium tracking-[-0.015em]">Corpus</h1>
          <p className="text-2xs text-ink-ghost">What Atlas can retrieve from</p>
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="btn btn-primary"
        >
          Add documents
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.py,.ts,.tsx,.js,.jsx,.go,.rs,.java,.rb,.sql,.yaml,.yml,.json"
          onChange={(e) => {
            if (e.target.files) void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[64rem] px-6 py-6">
          {counts && <Counters counts={counts} />}

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void upload(e.dataTransfer.files);
            }}
            className={`mt-5 rounded-[13px] border border-dashed px-6 py-7 text-center transition-colors duration-150 ${
              dragging ? "border-accent bg-[rgba(94,106,210,0.06)]" : "border-line-strong"
            }`}
          >
            <p className="text-sm text-ink-dim">
              {uploading > 0
                ? `Uploading ${uploading} file${uploading > 1 ? "s" : ""}…`
                : "Drop files here"}
            </p>
            <p className="mt-1 text-2xs text-ink-ghost">
              PDF, DOCX, Markdown, HTML, plain text, and source code · 20 MB each
            </p>
          </div>

          {error && (
            <div className="fade mt-4 rounded-[9px] border border-[rgba(217,83,79,0.28)] bg-[rgba(217,83,79,0.07)] px-3.5 py-2.5">
              <p className="text-xs leading-relaxed text-[#e8a19e]">{error}</p>
            </div>
          )}

          <div className="mt-5 flex flex-col gap-1">
            {docs.length === 0 ? (
              <p className="py-10 text-center text-sm text-ink-ghost">
                Nothing indexed yet.
              </p>
            ) : (
              docs.map((doc, i) => (
                <Row
                  key={doc.id}
                  doc={doc}
                  index={i}
                  onDelete={async () => {
                    // Optimistic: the row is gone from the server the moment the
                    // request lands, and waiting a round trip to admit it makes
                    // the table feel broken.
                    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
                    try {
                      await api.deleteDocument(doc.id);
                    } finally {
                      void load();
                    }
                  }}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Counters({ counts }: { counts: CorpusCounts }) {
  const cells = [
    { label: "Documents", value: counts.documents },
    { label: "Chunks", value: counts.chunks },
    { label: "Indexed", value: counts.ready },
    { label: "Failed", value: counts.failed },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[13px] border border-line bg-line sm:grid-cols-4">
      {cells.map((c, i) => (
        <div key={c.label} className={`rise d${i + 1} bg-surface px-4 py-3`}>
          <span className="label">{c.label}</span>
          <p
            className={`num mt-0.5 text-lg ${
              c.label === "Failed" && c.value > 0 ? "text-danger" : "text-ink"
            }`}
          >
            {c.value.toLocaleString()}
          </p>
        </div>
      ))}
    </div>
  );
}

function Row({
  doc,
  index,
  onDelete,
}: {
  doc: DocumentRow;
  index: number;
  onDelete: () => void;
}) {
  const live = LIVE.includes(doc.stage);
  const stageIndex = STAGES.indexOf(doc.stage);

  return (
    <article
      className="rise group flex items-center gap-3 rounded-[9px] border border-line bg-surface px-3.5 py-2.5 transition-colors duration-150 hover:border-line-strong"
      style={{ animationDelay: `${Math.min(index * 22, 200)}ms` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-ink">{doc.title}</span>
          <span className="chip chip-muted shrink-0">{doc.kind}</span>
        </div>

        <div className="mt-1 flex items-center gap-2 text-2xs text-ink-ghost">
          <span>{doc.source_kind}</span>
          <span>·</span>
          <span className="num">{formatBytes(doc.size_bytes)}</span>
          {doc.chunk_count > 0 && (
            <>
              <span>·</span>
              <span className="num">{doc.chunk_count} chunks</span>
            </>
          )}
        </div>

        {/* The pipeline rail. Segments fill as the worker advances, so a slow
            ingest reads as progress rather than as a hang. */}
        {live && (
          <div className="mt-2 flex items-center gap-1.5">
            <div className="flex flex-1 gap-px overflow-hidden rounded-full">
              {STAGES.slice(0, -1).map((s, i) => (
                <div
                  key={s}
                  className="h-[3px] flex-1 transition-colors duration-300"
                  style={{
                    background:
                      i < stageIndex
                        ? "var(--color-accent)"
                        : i === stageIndex
                          ? "var(--color-dense)"
                          : "rgba(255,255,255,0.05)",
                  }}
                />
              ))}
            </div>
            <span className="num w-24 shrink-0 text-2xs text-ink-faint">
              {doc.stage}
              {doc.stage === "embedding" && doc.progress > 0
                ? ` ${Math.round(doc.progress * 100)}%`
                : ""}
            </span>
          </div>
        )}

        {doc.error && (
          <p className="mt-1.5 text-2xs leading-relaxed text-[#e8a19e]">{doc.error}</p>
        )}
      </div>

      <StageBadge stage={doc.stage} />

      <button
        type="button"
        onClick={onDelete}
        title="Delete"
        className="shrink-0 rounded-[5px] px-1.5 py-1 text-2xs text-ink-ghost opacity-0 transition-all duration-150 hover:bg-[rgba(217,83,79,0.1)] hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      >
        Delete
      </button>
    </article>
  );
}

function StageBadge({ stage }: { stage: Stage }) {
  if (stage === "ready") {
    return (
      <span className="chip shrink-0 border-[rgba(78,166,122,0.3)] bg-[rgba(78,166,122,0.12)] text-[#7fc9a3]">
        ready
      </span>
    );
  }
  if (stage === "failed") {
    return (
      <span className="chip shrink-0 border-[rgba(217,83,79,0.32)] bg-[rgba(217,83,79,0.12)] text-[#e8a19e]">
        failed
      </span>
    );
  }
  if (stage === "skipped") {
    return <span className="chip chip-muted shrink-0">unchanged</span>;
  }
  return <span className="chip chip-dense shrink-0">{stage}</span>;
}
