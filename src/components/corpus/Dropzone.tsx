"use client";

import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Loader2, UploadCloud } from "lucide-react";
import { uploadDocument } from "@/lib/api";
import { cx } from "@/lib/format";
import { useConsole } from "@/lib/store";

/**
 * Uploads to /api/documents and hands off.
 *
 * The route returns as soon as the row exists — extract, chunk, embed and index
 * all run server-side afterwards — so there is nothing to wait for here beyond
 * the POST. The stage column in the table is the progress indicator, fed by the
 * store's poll.
 */
export function Dropzone() {
  const { addDocuments, refreshCorpus } = useConsole();
  const [over, setOver] = useState(false);
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const ingest = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setErrors([]);
      setPending((n) => n + files.length);

      // Sequential: a dozen parallel multipart POSTs plus a dozen embedding
      // jobs is the fastest way to meet a rate limit.
      for (const file of files) {
        try {
          addDocuments([await uploadDocument(file)]);
        } catch (err) {
          setErrors((e) => [
            ...e,
            `${file.name}: ${err instanceof Error ? err.message : "upload failed"}`,
          ]);
        } finally {
          setPending((n) => n - 1);
        }
      }

      void refreshCorpus();
    },
    [addDocuments, refreshCorpus],
  );

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void ingest(Array.from(e.dataTransfer.files));
        }}
        onClick={() => inputRef.current?.click()}
        className={cx(
          "group relative cursor-pointer border border-dashed px-5 py-8 text-center transition-all duration-200",
          over
            ? "border-dense bg-dense/[0.07]"
            : "border-ink-600 hover:border-bone-600 hover:bg-ink-850/60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.md,.markdown,.txt,.html,.htm,.docx"
          className="hidden"
          onChange={(e) => {
            void ingest(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />

        {pending > 0 ? (
          <Loader2
            size={22}
            strokeWidth={1.3}
            className="mx-auto animate-spin text-dense"
          />
        ) : (
          <UploadCloud
            size={22}
            strokeWidth={1.3}
            className={cx(
              "mx-auto transition-colors duration-200",
              over ? "text-dense" : "text-bone-500 group-hover:text-bone-300",
            )}
          />
        )}

        <p className="mt-2.5 text-[13px] text-bone-200">
          {pending > 0
            ? `Uploading ${pending} file${pending === 1 ? "" : "s"}…`
            : "Drop documents to ingest"}
        </p>
        <p className="mt-1 text-[11.5px] leading-snug text-bone-500">
          pdf · md · txt · html · docx — 20 MB max
        </p>
      </div>

      {errors.map((message) => (
        <p
          key={message}
          className="mt-2 flex items-start gap-2 border-l-2 border-l-alert/60 bg-alert/[0.05] py-1.5 pl-2.5 pr-2 text-[11.5px] leading-snug text-alert/90"
        >
          <AlertTriangle size={12} className="mt-[1px] shrink-0" strokeWidth={1.8} />
          {message}
        </p>
      ))}
    </div>
  );
}
