"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Library,
  MessagesSquare,
  Settings2,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/lib/format";
import { useConsole } from "@/lib/store";

const NAV: { href: string; label: string; icon: LucideIcon; key: string }[] = [
  { href: "/", label: "Console", icon: MessagesSquare, key: "1" },
  { href: "/corpus", label: "Corpus", icon: Library, key: "2" },
  { href: "/playground", label: "Retrieval", icon: SlidersHorizontal, key: "3" },
  { href: "/settings", label: "Settings", icon: Settings2, key: "4" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="bloom relative flex h-dvh flex-col overflow-hidden bg-ink-900">
      {/* Very faint grid, sits under everything including the bloom. */}
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-[0.5]" />

      <TopBar />

      <div className="relative flex min-h-0 flex-1">
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-ink-700 bg-ink-850/40 py-3">
          {NAV.map(({ href, label, icon: Icon, key }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                title={`${label}  ·  ⌘${key}`}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "group relative flex h-11 w-11 items-center justify-center transition-colors duration-200",
                  active ? "text-dense" : "text-bone-500 hover:text-bone-200",
                )}
              >
                {/* Active marker: a bar on the rail edge, not a filled pill. */}
                <span
                  className={cx(
                    "absolute left-[-1px] h-6 w-[2px] transition-all duration-300 ease-[var(--ease-out-instrument)]",
                    active
                      ? "bg-dense opacity-100 shadow-[0_0_10px_var(--color-dense)]"
                      : "opacity-0",
                  )}
                />
                <Icon size={17} strokeWidth={1.6} />
                <span className="label-micro pointer-events-none absolute left-[calc(100%+6px)] z-50 whitespace-nowrap border border-ink-600 bg-ink-800 px-2 py-1.5 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                  {label}
                </span>
              </Link>
            );
          })}
        </nav>

        <main className="relative min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function TopBar() {
  const { settings, documents, params, health } = useConsole();
  const ready = documents.filter((d) => d.stage === "ready");
  const chunks = ready.reduce((s, d) => s + d.chunkCount, 0);

  // Null health means the check has not come back yet — neither claim is safe.
  const supabase: Health = !health
    ? "unknown"
    : health.database.ok
      ? "up"
      : "down";
  const gemini: Health = !health
    ? "unknown"
    : health.missing.includes("GEMINI_API_KEY")
      ? "down"
      : "up";

  return (
    <header className="relative z-10 flex h-11 shrink-0 items-center gap-4 border-b border-ink-700 bg-ink-850/60 px-4 backdrop-blur-sm">
      {/* Wordmark. The serif against all-mono chrome is the whole identity. */}
      <Link href="/" className="flex items-baseline gap-2 no-underline">
        <span className="font-display text-[19px] leading-none text-bone-100">
          popo
        </span>
        <span className="label-micro hidden !text-[8.5px] sm:inline">
          retrieval console
        </span>
      </Link>

      <span className="h-4 w-px bg-ink-600" />

      <div className="flex min-w-0 items-center gap-3 overflow-hidden">
        <Stat label="corpus" value={`${ready.length} docs`} />
        <Stat label="chunks" value={chunks.toLocaleString()} />
        <Stat label="α" value={params.alpha.toFixed(2)} accent />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <Conn
          label="supabase"
          note={
            health && !health.database.ok
              ? health.database.error
              : `pgvector ${health?.embedDim ?? settings.embeddingDim}d`
          }
          state={supabase}
        />
        <Conn
          label="gemini"
          note={
            gemini === "down"
              ? "GEMINI_API_KEY is not set"
              : health?.generationModel ?? settings.generationModel
          }
          state={gemini}
        />
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="label-micro">{label}</span>
      <span
        className={cx(
          "tabular text-[11.5px]",
          accent ? "text-dense" : "text-bone-200",
        )}
      >
        {value}
      </span>
    </span>
  );
}

type Health = "up" | "down" | "unknown";

/** Connection pill, fed by /api/health. Grey until the first check returns. */
function Conn({
  label,
  note,
  state,
}: {
  label: string;
  note: string;
  state: Health;
}) {
  const up = state === "up";
  return (
    <span
      className="group flex items-center gap-1.5 whitespace-nowrap"
      title={`${label}: ${note}`}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 rounded-full",
          up ? "bg-signal" : state === "down" ? "bg-alert" : "bg-ink-500",
        )}
        style={
          up
            ? {
                boxShadow: "0 0 7px var(--color-signal)",
                animation: "pulse-dot 3.2s ease-in-out infinite",
              }
            : undefined
        }
      />
      <span className="label-micro group-hover:!text-bone-300">{label}</span>
      <span className="tabular hidden max-w-[220px] truncate text-[10.5px] text-bone-600 lg:inline">
        {note}
      </span>
    </span>
  );
}
