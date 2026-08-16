"use client";

import { useId, type ReactNode } from "react";
import { cx } from "@/lib/format";

/* ------------------------------------------------------------- Slider --- */

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  hint,
  accent = "var(--color-dense)",
  /** Optional pair of end-labels, e.g. keyword ← → vector. */
  ends,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  hint?: string;
  accent?: string;
  ends?: [string, string];
}) {
  const id = useId();
  return (
    <div className="group">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="label-micro cursor-ew-resize">
          {label}
        </label>
        <output
          htmlFor={id}
          className="tabular text-[12px] text-bone-100"
          style={{ color: accent }}
        >
          {format ? format(value) : value}
        </output>
      </div>

      <input
        id={id}
        type="range"
        className="slider-instrument mt-1"
        style={{ ["--track-accent" as string]: accent }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />

      {ends && (
        <div className="-mt-0.5 flex justify-between">
          <span className="label-micro !tracking-[0.1em]">{ends[0]}</span>
          <span className="label-micro !tracking-[0.1em]">{ends[1]}</span>
        </div>
      )}
      {hint && (
        <p className="mt-1 text-[11px] leading-snug text-bone-500 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          {hint}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- Toggle --- */

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  accent = "var(--color-dense)",
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  accent?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center gap-2.5 py-1 text-left"
    >
      <span
        className={cx(
          "relative h-[14px] w-[26px] shrink-0 border transition-colors duration-200",
          checked ? "border-transparent" : "border-ink-500 bg-ink-800",
        )}
        style={checked ? { background: `color-mix(in oklab, ${accent} 26%, transparent)` } : undefined}
      >
        <span
          className="absolute top-[2px] h-[8px] w-[8px] transition-all duration-200 ease-[var(--ease-out-instrument)]"
          style={{
            left: checked ? 15 : 3,
            background: checked ? accent : "var(--color-bone-500)",
            boxShadow: checked ? `0 0 8px ${accent}` : undefined,
          }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cx(
            "label-micro block transition-colors",
            checked ? "!text-bone-200" : "group-hover:!text-bone-400",
          )}
        >
          {label}
        </span>
        {hint && (
          <span className="mt-0.5 block text-[11px] leading-snug text-bone-500">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

/* ---------------------------------------------------------- Segmented --- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex border border-ink-700">
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cx(
              "label-micro px-2.5 py-1.5 transition-colors duration-150",
              i > 0 && "border-l border-ink-700",
              active
                ? "!text-ink-900 bg-bone-200"
                : "hover:!text-bone-200 hover:bg-ink-750",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- Select --- */

export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string; note?: string }[];
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label-micro">
        {label}
      </label>
      <div className="relative mt-1.5">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none border border-ink-700 bg-ink-800 px-2.5 py-2 pr-8 font-mono text-[12px] text-bone-100 transition-colors hover:border-ink-500 focus:border-dense focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-ink-800">
              {o.label}
              {o.note ? `  ·  ${o.note}` : ""}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-bone-500">
          ▾
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- Badge --- */

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "dense" | "sparse" | "signal" | "alert" | "caution";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-ink-600 text-bone-400",
    dense: "border-dense/40 text-dense",
    sparse: "border-sparse/40 text-sparse",
    signal: "border-signal/40 text-signal",
    alert: "border-alert/45 text-alert",
    caution: "border-caution/40 text-caution",
  };
  return (
    <span
      className={cx(
        "label-micro inline-flex items-center gap-1 border px-1.5 py-[3px] !leading-none",
        tones[tone],
        className,
      )}
      style={{ color: "inherit" }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- Button --- */

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  type = "button",
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "solid" | "ghost" | "quiet";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const variants = {
    solid:
      "bg-dense text-ink-900 hover:bg-[#f7b876] disabled:bg-ink-700 disabled:text-bone-600",
    ghost:
      "border border-ink-600 text-bone-200 hover:border-bone-500 hover:text-bone-100 disabled:text-bone-600 disabled:hover:border-ink-600",
    quiet: "text-bone-400 hover:text-bone-100 disabled:text-bone-600",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "label-micro inline-flex items-center gap-1.5 px-2.5 py-1.5 transition-colors duration-150 disabled:cursor-not-allowed",
        variants[variant],
        className,
      )}
      style={{ color: "inherit" }}
    >
      {children}
    </button>
  );
}
