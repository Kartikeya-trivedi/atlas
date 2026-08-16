"use client";

import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, Square } from "lucide-react";
import { cx } from "@/lib/format";

export function Composer({
  onSend,
  onStop,
  busy,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with content up to a ceiling, then scroll internally.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  // "/" focuses the composer from anywhere, as long as we're not already
  // typing into a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit() {
    if (!value.trim() || busy) return;
    onSend(value);
    setValue("");
  }

  return (
    <div className="shrink-0 border-t border-ink-700 bg-ink-850/80 p-3 backdrop-blur-sm">
      <div
        className={cx(
          "flex items-end gap-2 border bg-ink-800 px-3 py-2 transition-colors duration-200",
          "border-ink-600 focus-within:border-dense/60",
        )}
      >
        <span className="label-micro mt-[7px] shrink-0 !text-dense">›</span>

        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask the corpus…"
          className="scroll-thin max-h-[168px] min-h-[22px] flex-1 resize-none bg-transparent text-[14px] leading-relaxed text-bone-100 placeholder:text-bone-600 focus:outline-none"
        />

        {busy ? (
          <button
            type="button"
            onClick={onStop}
            title="Stop generating"
            className="label-micro mb-[2px] flex shrink-0 items-center gap-1.5 border border-ink-600 px-2 py-1.5 text-bone-300 transition-colors hover:border-alert/60 hover:!text-alert"
          >
            <Square size={9} strokeWidth={2.4} fill="currentColor" />
            stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            title="Send  ·  ⏎"
            className={cx(
              "mb-[2px] flex shrink-0 items-center gap-1.5 px-2 py-1.5 transition-colors",
              value.trim()
                ? "bg-dense text-ink-900 hover:bg-[#f7b876]"
                : "text-bone-600",
            )}
          >
            <CornerDownLeft size={12} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-3 px-1">
        <span className="label-micro !text-[9px]">⏎ send</span>
        <span className="label-micro !text-[9px]">⇧⏎ newline</span>
        <span className="label-micro !text-[9px]">/ focus</span>
      </div>
    </div>
  );
}
