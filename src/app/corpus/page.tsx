"use client";

import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Dropzone } from "@/components/corpus/Dropzone";
import { Badge } from "@/components/ui/Controls";
import { Panel } from "@/components/ui/Panel";
import { bytes, compact, cx, relTime } from "@/lib/format";
import { useConsole } from "@/lib/store";
import { INGEST_STAGES, type DocumentRecord, type IngestStage } from "@/lib/types";

const STAGE_LABEL: Record<IngestStage, string> = {
  queued: "queued",
  extracting: "extracting text",
  chunking: "chunking",
  embedding: "embedding",
  indexing: "building index",
  ready: "ready",
  failed: "failed",
};

export default function CorpusPage() {
  const { documents, corpusError, corpusLoading } = useConsole();

  const ready = documents.filter((d) => d.stage === "ready");
  const working = documents.filter(
    (d) => d.stage !== "ready" && d.stage !== "failed",
  );
  const failed = documents.filter((d) => d.stage === "failed");

  return (
    <div className="flex h-full min-h-0">
      <Panel
        label="ingest"
        className="w-[300px] shrink-0 border-y-0 border-l-0"
        scroll
      >
        <div className="p-3.5">
          <Dropzone />

          <div className="mt-5">
            <span className="label-micro">pipeline</span>
            <ol className="mt-2.5 space-y-0">
              {[
                ["extract", "text layer, tables, headings"],
                ["chunk", "structure-first, 12% overlap"],
                ["contextualise", "prepend title + heading path"],
                ["embed", "gemini-embedding-001, batches of 100"],
                ["index", "HNSW on the vector, GIN on the tsvector"],
              ].map(([name, note], i) => (
                <li key={name} className="flex gap-2.5">
                  <div className="flex flex-col items-center">
                    <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rotate-45 bg-dense" />
                    {i < 4 && <span className="w-px flex-1 bg-ink-700" />}
                  </div>
                  <div className="pb-3.5">
                    <span className="label-micro !text-bone-300">{name}</span>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-bone-500">
                      {note}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-px border-t border-ink-800 pt-3.5">
            <Tally label="ready" value={ready.length} />
            <Tally
              label="working"
              value={working.length}
              tone={working.length ? "caution" : undefined}
            />
            <Tally
              label="failed"
              value={failed.length}
              tone={failed.length ? "alert" : undefined}
            />
          </div>
        </div>
      </Panel>

      <Panel
        label={`corpus · ${documents.length} documents`}
        className="min-w-0 flex-1 border-0"
        scroll
        aside={
          <span className="tabular text-[10.5px] text-bone-600">
            {compact(ready.reduce((s, d) => s + d.chunkCount, 0))} chunks indexed
          </span>
        }
      >
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-ink-850">
            <tr className="border-b border-ink-700">
              {["document", "stage", "chunks", "tokens", "size", "added", ""].map(
                (h, i) => (
                  <th
                    key={h || i}
                    className={cx(
                      "label-micro px-3 py-2 text-left font-normal",
                      i > 1 && i < 6 && "text-right",
                    )}
                  >
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <DocRow key={doc.id} doc={doc} />
            ))}
          </tbody>
        </table>

        {corpusError && (
          <p className="m-4 flex items-start gap-2 border border-alert/35 bg-alert/[0.05] px-3 py-2.5 text-[12px] leading-relaxed text-alert">
            <AlertTriangle size={13} className="mt-[2px] shrink-0" strokeWidth={1.8} />
            {corpusError}
          </p>
        )}

        {!corpusError && documents.length === 0 && (
          <p className="flex items-center justify-center gap-2 px-4 py-10 text-center text-[12.5px] text-bone-500">
            {corpusLoading ? (
              <>
                <Loader2 size={13} className="animate-spin" strokeWidth={1.8} />
                Loading the corpus…
              </>
            ) : (
              "Corpus is empty. Drop a document to begin."
            )}
          </p>
        )}
      </Panel>
    </div>
  );
}

function Tally({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "caution" | "alert";
}) {
  const color =
    tone === "alert"
      ? "var(--color-alert)"
      : tone === "caution"
        ? "var(--color-caution)"
        : "var(--color-bone-200)";
  return (
    <div>
      <div className="tabular text-[17px] leading-none" style={{ color }}>
        {value}
      </div>
      <div className="label-micro mt-1">{label}</div>
    </div>
  );
}

function DocRow({ doc }: { doc: DocumentRecord }) {
  const { removeDocument } = useConsole();
  const active = doc.stage !== "ready" && doc.stage !== "failed";
  const stageIndex = INGEST_STAGES.indexOf(doc.stage);

  return (
    <>
      <tr className="group border-b border-ink-800 transition-colors hover:bg-ink-850/70">
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="label-micro w-8 shrink-0 border border-ink-600 px-1 py-[3px] text-center !text-[8.5px]">
              {doc.kind}
            </span>
            <span className="truncate text-[12.5px] text-bone-200">
              {doc.title}
            </span>
          </div>
        </td>

        <td className="px-3 py-2.5">
          {doc.stage === "failed" ? (
            <Badge tone="alert">failed</Badge>
          ) : doc.stage === "ready" ? (
            <Badge tone="signal">ready</Badge>
          ) : (
            <div className="min-w-[130px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="label-micro !text-caution">
                  {STAGE_LABEL[doc.stage]}
                </span>
                {doc.stage === "embedding" && (
                  <span className="tabular text-[10px] text-bone-500">
                    {Math.round(doc.progress * 100)}%
                  </span>
                )}
              </div>
              {/* Segmented track: one cell per pipeline stage. */}
              <div className="mt-1.5 flex h-[3px] gap-px">
                {INGEST_STAGES.slice(0, -1).map((s, i) => (
                  <span
                    key={s}
                    className="h-full flex-1 transition-colors duration-300"
                    style={{
                      background:
                        i < stageIndex
                          ? "var(--color-caution)"
                          : i === stageIndex
                            ? `color-mix(in oklab, var(--color-caution) ${
                                20 + doc.progress * 80
                              }%, var(--color-ink-700))`
                            : "var(--color-ink-700)",
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </td>

        <td className="tabular px-3 py-2.5 text-right text-[12px] text-bone-300">
          {doc.chunkCount || "—"}
        </td>
        <td className="tabular px-3 py-2.5 text-right text-[12px] text-bone-400">
          {doc.tokenCount ? compact(doc.tokenCount) : "—"}
        </td>
        <td className="tabular px-3 py-2.5 text-right text-[12px] text-bone-500">
          {bytes(doc.sizeBytes)}
        </td>
        <td className="tabular whitespace-nowrap px-3 py-2.5 text-right text-[11.5px] text-bone-600">
          {relTime(doc.addedAt)}
        </td>

        <td className="px-2 py-2.5">
          <button
            type="button"
            onClick={() => removeDocument(doc.id)}
            title="Remove from corpus"
            className="text-bone-600 opacity-0 transition-all duration-150 hover:text-alert group-hover:opacity-100"
          >
            <Trash2 size={12} strokeWidth={1.7} />
          </button>
        </td>
      </tr>

      {doc.error && (
        <tr className="border-b border-ink-800">
          <td colSpan={7} className="px-3 pb-2.5">
            <p className="flex items-start gap-2 border-l-2 border-l-alert/60 bg-alert/[0.05] py-1.5 pl-2.5 pr-2 text-[11.5px] leading-snug text-alert/90">
              <AlertTriangle size={12} className="mt-[1px] shrink-0" strokeWidth={1.8} />
              {doc.error}
            </p>
          </td>
        </tr>
      )}

      {active && <tr aria-hidden className="h-0" />}
    </>
  );
}
