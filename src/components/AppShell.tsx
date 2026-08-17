"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AtlasMark } from "@/components/icons";
import { api, type HealthReport } from "@/lib/api";
import { EMPTY, chats, relativeTime } from "@/lib/chats";

const NAV = [
  { href: "/ask", label: "Ask" },
  { href: "/connectors", label: "Connectors" },
  { href: "/corpus", label: "Corpus" },
] as const;

/**
 * The shell: one fixed rail, one scrolling column.
 *
 * The rail is ordered by how often you touch it — new chat, then where you are
 * going, then where you have been. The debugger sits at the bottom with the
 * channel legend, because it is a tool you reach for occasionally and not the
 * point of the product.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // The landing page carries its own nav and needs the whole viewport. Framing
  // a marketing page in app chrome makes it look like a settings screen.
  if (pathname === "/") return <>{children}</>;

  return (
    <div className="relative z-10 flex min-h-screen">
      <aside className="glass fixed inset-y-0 left-0 z-20 hidden w-[240px] flex-col border-r border-line md:flex">
        <Workspace />
        <NewChat />
        <Nav pathname={pathname} />
        <History />
        <Footer pathname={pathname} />
      </aside>

      <main className="min-w-0 flex-1 md:pl-[240px]">{children}</main>
    </div>
  );
}

function Workspace() {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2.5 px-4">
      <span className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-line-strong bg-s2 text-ink">
        <AtlasMark className="h-[15px] w-[15px]" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.8125rem] font-medium leading-tight tracking-[-0.015em]">
          Acme
        </span>
        <span className="block text-2xs leading-tight text-ink-ghost">Atlas</span>
      </span>
    </div>
  );
}

function NewChat() {
  return (
    <div className="px-3 pb-1">
      <Link
        href="/ask"
        onClick={() => chats.start()}
        className="flex h-8 w-full items-center gap-2 rounded-[7px] border border-line-strong bg-s2 px-2.5 text-[0.8125rem] text-ink-dim shadow-[inset_0_1px_0_rgba(255,250,240,0.05)] transition-colors duration-150 hover:border-line-lit hover:bg-s3 hover:text-ink"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path
            d="M8 3.4v9.2M3.4 8h9.2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        New chat
      </Link>
    </div>
  );
}

function Nav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-col gap-px px-3 pt-2">
      {NAV.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          label={item.label}
          active={pathname.startsWith(item.href)}
        />
      ))}
    </nav>
  );
}

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`relative flex h-[30px] items-center rounded-[6px] px-2.5 text-[0.8125rem] transition-colors duration-150 ${
        active
          ? "bg-[rgba(255,250,240,0.055)] text-ink"
          : "text-ink-dim hover:bg-[rgba(255,250,240,0.03)] hover:text-ink"
      }`}
    >
      {/* A 2px bar bleeding off the rail's left edge rather than a filled pill:
          quieter, and it survives the translucent background. */}
      <span
        className={`absolute -left-3 h-3.5 w-[2px] rounded-r bg-ink transition-opacity duration-150 ${
          active ? "opacity-100" : "opacity-0"
        }`}
      />
      {label}
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────── history ── */

function History() {
  const sessions = useSyncExternalStore(
    chats.subscribe,
    chats.snapshot,
    () => EMPTY,
  );
  const activeId = useSyncExternalStore(chats.subscribe, chats.active, () => null);

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <span className="label px-4 pb-1.5">Recent</span>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {sessions.length === 0 ? (
          <p className="px-2.5 py-2 text-2xs leading-relaxed text-ink-ghost">
            Conversations you start show up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-px">
            {sessions.map((s) => (
              <li key={s.id} className="group relative">
                <Link
                  href="/ask"
                  onClick={() => chats.select(s.id)}
                  className={`block rounded-[6px] px-2.5 py-1.5 pr-6 transition-colors duration-150 ${
                    s.id === activeId
                      ? "bg-[rgba(255,250,240,0.05)]"
                      : "hover:bg-[rgba(255,250,240,0.028)]"
                  }`}
                >
                  <span
                    className={`block truncate text-xs ${
                      s.id === activeId ? "text-ink" : "text-ink-dim"
                    }`}
                  >
                    {s.title}
                  </span>
                  <span className="mt-0.5 block text-2xs text-ink-ghost">
                    {relativeTime(s.updated)}
                  </span>
                </Link>
                <button
                  type="button"
                  aria-label={`Delete ${s.title}`}
                  onClick={() => chats.remove(s.id)}
                  className="absolute right-1 top-1.5 rounded-[4px] p-1 text-ink-ghost opacity-0 transition-opacity duration-150 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
                    <path
                      d="M2.5 2.5l7 7M9.5 2.5l-7 7"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────── footer ── */

function Footer({ pathname }: { pathname: string }) {
  return (
    <div className="shrink-0 border-t border-line px-3 py-3">
      <NavLink href="/debug" label="Debug" active={pathname.startsWith("/debug")} />
      <Legend />
      <HealthPill />
    </div>
  );
}

/**
 * The channel legend lives here, next to the debugger it explains, rather than
 * on every screen. Two colours, one sentence — that is the whole key.
 */
function Legend() {
  return (
    <div className="mt-2.5 flex flex-col gap-1.5 px-2.5">
      <div className="flex items-center gap-1.5">
        <span className="chip chip-dense">dense</span>
        <span className="chip chip-lexical">lexical</span>
      </div>
      <div
        className="h-[3px] rounded-full"
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
    <div className="mt-3 flex flex-col gap-1 border-t border-line px-2.5 pt-3">
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            bad ? "bg-danger" : health == null ? "bg-ink-ghost" : "bg-positive"
          }`}
          style={
            ok
              ? { boxShadow: "0 0 0 3px rgba(95,185,138,0.14)" }
              : bad
                ? { boxShadow: "0 0 0 3px rgba(224,115,109,0.12)" }
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
