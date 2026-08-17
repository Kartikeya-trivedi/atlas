"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type HealthReport } from "@/lib/api";

const NAV = [
  { href: "/", label: "Ask", hint: "Retrieve and answer" },
  { href: "/debug", label: "Debug", hint: "Inspect retrieval" },
  { href: "/corpus", label: "Corpus", hint: "Documents and sources" },
] as const;

/**
 * The shell: a narrow fixed rail and one scrolling column.
 *
 * The rail carries the wordmark, three destinations, the channel legend, and a
 * health readout. The legend is not decoration — it teaches the colour language
 * once, on every screen, so the debugger needs no key of its own.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="relative z-10 flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[212px] flex-col border-r border-line bg-[rgba(9,10,13,0.72)] backdrop-blur-xl md:flex">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <Mark />
          <span className="text-[0.9rem] font-semibold tracking-[-0.02em]">
            Atlas
          </span>
        </div>

        <nav className="flex flex-col gap-0.5 px-3 pt-2">
          {NAV.map((item, i) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.hint}
                className={`rise d${i + 1} relative flex h-8 items-center rounded-[6px] px-2.5 text-[0.8125rem] transition-colors duration-150 ${
                  active
                    ? "bg-[rgba(255,255,255,0.055)] text-ink"
                    : "text-ink-dim hover:bg-[rgba(255,255,255,0.03)] hover:text-ink"
                }`}
              >
                {/* Active marker: a 2px bar bleeding off the rail's left edge,
                    rather than a filled pill. Quieter, and it survives the
                    translucent background. */}
                <span
                  className={`absolute -left-3 h-4 w-[2px] rounded-r bg-accent transition-opacity duration-150 ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-4 p-4">
          <Legend />
          <HealthPill />
        </div>
      </aside>

      <main className="min-w-0 flex-1 md:pl-[212px]">{children}</main>
    </div>
  );
}

/**
 * The wordmark: two overlapping arcs, one per channel, meeting where they fuse.
 * The product's whole thesis at 19 pixels.
 */
function Mark() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle
        cx="7.6"
        cy="10"
        r="5.4"
        stroke="var(--color-dense)"
        strokeWidth="1.5"
        opacity="0.95"
      />
      <circle
        cx="12.4"
        cy="10"
        r="5.4"
        stroke="var(--color-lexical)"
        strokeWidth="1.5"
        opacity="0.95"
      />
    </svg>
  );
}

function Legend() {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">Channels</span>
      <div className="flex items-center gap-1.5">
        <span className="chip chip-dense">dense</span>
        <span className="chip chip-lexical">lexical</span>
      </div>
      <div
        className="mt-1 h-[3px] rounded-full"
        style={{
          background:
            "linear-gradient(90deg, var(--color-dense), var(--color-lexical))",
        }}
      />
      <span className="text-2xs leading-[1.35] text-ink-ghost">
        Fusion leans toward whichever channel ranked a passage higher.
      </span>
    </div>
  );
}

function HealthPill() {
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .health()
      .then((h) => {
        if (alive) setHealth(h);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const ok = health?.ok ?? false;
  const label = failed
    ? "API unreachable"
    : health == null
      ? "Checking…"
      : ok
        ? "Operational"
        : "Setup incomplete";

  // The detail line answers the only question a red dot raises: which half.
  const detail = failed
    ? "Start the FastAPI service"
    : health == null
      ? null
      : !health.config.ok
        ? "Check .env.local"
        : !health.database.ok
          ? "Database unreachable"
          : Object.values(health.extensions).some((v) => !v) ||
              health.migrations_applied.length === 0
            ? "Run the migrations"
            : null;

  const bad = failed || (health != null && !ok);

  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            bad ? "bg-danger" : health == null ? "bg-ink-ghost" : "bg-positive"
          }`}
          style={
            ok
              ? { boxShadow: "0 0 0 3px rgba(78,166,122,0.14)" }
              : bad
                ? { boxShadow: "0 0 0 3px rgba(217,83,79,0.12)" }
                : undefined
          }
        />
        <span className="text-2xs text-ink-faint">{label}</span>
      </div>
      {detail && (
        <span className="pl-3.5 text-2xs leading-tight text-ink-ghost">
          {detail}
        </span>
      )}
    </div>
  );
}
