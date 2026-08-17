import Link from "next/link";

/**
 * Landing page.
 *
 * The whole page is built around one decision: the headline is enormous and
 * everything else is quiet. A marketing page competes for a few seconds of
 * attention, and typographic scale is the only thing that reads before anyone
 * has decided to read.
 */
export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-black">
      <Nav />
      <Hero />
      <Proof />
      <Split />
      <Closer />
      <Footer />
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────  nav ── */

const LINKS = [
  { href: "/ask", label: "Ask" },
  { href: "/debug", label: "Debug" },
  { href: "/corpus", label: "Corpus" },
];

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[rgba(255,255,255,0.05)] bg-[rgba(0,0,0,0.62)] backdrop-blur-xl">
      <div className="mx-auto flex h-[62px] max-w-[1240px] items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="text-[0.95rem] font-semibold tracking-[-0.025em] text-white">
            Atlas
          </span>
        </Link>

        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[0.8125rem] text-[#8a9099] transition-colors duration-150 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/ask"
          className="rounded-full bg-white px-4 py-[7px] text-[0.8125rem] font-medium text-black transition-opacity duration-150 hover:opacity-85"
        >
          Open app
        </Link>
      </div>
    </header>
  );
}

function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="7.6" cy="10" r="5.4" stroke="#6572e8" strokeWidth="1.5" />
      <circle cx="12.4" cy="10" r="5.4" stroke="#d99a4e" strokeWidth="1.5" />
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────────  hero ── */

function Hero() {
  return (
    <section className="relative px-6 pt-[168px]">
      {/* One wide, very faint wash behind the headline. Enough to lift the type
          off pure black without becoming a visible gradient. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[820px]"
        style={{
          background:
            "radial-gradient(58rem 30rem at 30% 0%, rgba(101,114,232,0.10), transparent 62%), radial-gradient(46rem 26rem at 78% 6%, rgba(217,154,78,0.06), transparent 64%)",
        }}
      />

      <div className="relative mx-auto max-w-[1240px]">
        <h1
          className="rise max-w-[19ch] font-semibold text-white"
          style={{
            fontSize: "clamp(2.6rem, 7.4vw, 5.6rem)",
            lineHeight: 0.95,
            letterSpacing: "-0.042em",
          }}
        >
          Retrieval you can put on trial
        </h1>

        <p className="rise d2 mt-7 max-w-[46ch] text-[1.0625rem] leading-[1.62] text-[#8a9099]">
          Two retrievers run on every question — one for what you meant, one for
          what you typed. Atlas shows you which one earned each passage, and
          refuses to answer when neither did.
        </p>

        <div className="rise d3 mt-9 flex flex-wrap items-center gap-3">
          <Link
            href="/ask"
            className="rounded-full bg-white px-5 py-2.5 text-[0.875rem] font-medium text-black transition-opacity duration-150 hover:opacity-85"
          >
            Open app
          </Link>
          <Link
            href="/debug"
            className="rounded-full border border-[rgba(255,255,255,0.13)] px-5 py-2.5 text-[0.875rem] font-medium text-white transition-colors duration-150 hover:border-[rgba(255,255,255,0.28)] hover:bg-[rgba(255,255,255,0.04)]"
          >
            See the trace
          </Link>
        </div>

        <ProductFrame />
      </div>
    </section>
  );
}

/**
 * The product shot — a real render of the debugger's three columns, not an
 * image. It stays honest as the product changes, and it is the one screen that
 * explains the pitch without a caption.
 */
function ProductFrame() {
  return (
    <div className="rise d4 relative mt-20">
      {/* Glow under the frame, cropped by the frame's own rounding. */}
      <div
        className="pointer-events-none absolute -inset-x-16 -top-8 bottom-0 opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(40rem 14rem at 50% 0%, rgba(101,114,232,0.18), transparent 70%)",
        }}
      />
      <div className="relative overflow-hidden rounded-[14px] border border-[rgba(255,255,255,0.09)] bg-[#0b0d10] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]">
        <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.055)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Mark size={15} />
            <span className="text-[0.75rem] text-[#626871]">
              Where do we still reference{" "}
              <span className="font-mono text-[#9ba1a9]">/v1/auth</span>?
            </span>
          </div>
          <span className="font-mono text-[0.6875rem] tabular-nums text-[#3d434b]">
            412ms
          </span>
        </div>

        <div className="grid gap-px bg-[rgba(255,255,255,0.05)] sm:grid-cols-3">
          <MockColumn
            title="Dense"
            note="cosine over HNSW"
            dot="#6572e8"
            rows={[
              ["auth/service.py › TokenService", 0.88, "#6572e8"],
              ["docs/architecture.md › Sessions", 0.81, "#6572e8"],
              ["auth/middleware.py › verify", 0.74, "#6572e8"],
            ]}
          />
          <MockColumn
            title="Lexical"
            note="BM25 over the tsvector"
            dot="#d99a4e"
            rows={[
              ["migration.md › Breaking changes", 0.94, "#d99a4e"],
              ["client.ts › legacyAuth", 0.86, "#d99a4e"],
              ["auth/service.py › TokenService", 0.62, "#d99a4e"],
            ]}
          />
          <MockColumn
            title="Fused"
            note="weighted RRF · α 0.50"
            dot="gradient"
            rows={[
              ["auth/service.py › TokenService", 1.0, "gradient"],
              ["migration.md › Breaking changes", 0.91, "gradient"],
              ["client.ts › legacyAuth", 0.78, "gradient"],
            ]}
            badges
          />
        </div>
      </div>
    </div>
  );
}

function MockColumn({
  title,
  note,
  dot,
  rows,
  badges,
}: {
  title: string;
  note: string;
  dot: string;
  rows: [string, number, string][];
  badges?: boolean;
}) {
  const gradient = "linear-gradient(90deg, #6572e8, #d99a4e)";
  return (
    <div className="bg-[#0b0d10] p-3.5">
      <div className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: dot === "gradient" ? gradient : dot }}
        />
        <span className="text-[0.75rem] font-medium text-white">{title}</span>
      </div>
      <p className="mt-1 text-[0.6875rem] text-[#3d434b]">{note}</p>

      <div className="mt-3 flex flex-col gap-2.5">
        {rows.map(([label, score, tone], i) => (
          <div key={label + i}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-mono text-[0.6875rem] text-[#9ba1a9]">
                {label}
              </span>
              <span className="font-mono text-[0.6875rem] tabular-nums text-[#626871]">
                {score.toFixed(2)}
              </span>
            </div>
            <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-[rgba(255,255,255,0.05)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${score * 100}%`,
                  background: tone === "gradient" ? gradient : tone,
                }}
              />
            </div>
            {badges && (
              <div className="mt-1.5 flex gap-1">
                <span className="rounded-[3px] border border-[rgba(101,114,232,0.32)] bg-[rgba(101,114,232,0.14)] px-1 font-mono text-[0.625rem] text-[#a8b0f5]">
                  d{i + 1}
                </span>
                <span className="rounded-[3px] border border-[rgba(217,154,78,0.3)] bg-[rgba(217,154,78,0.13)] px-1 font-mono text-[0.625rem] text-[#e8c48d]">
                  l{i === 0 ? 3 : i}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────  proof ── */

function Proof() {
  const stats = [
    ["2", "retrievers per query"],
    ["0", "chunks ranked past your permissions"],
    ["1", "call to re-sync an unchanged repo"],
    ["6", "migrations, no ORM"],
  ];
  return (
    <section className="border-y border-[rgba(255,255,255,0.05)] px-6 py-14 mt-32">
      <div className="mx-auto grid max-w-[1240px] grid-cols-2 gap-8 lg:grid-cols-4">
        {stats.map(([n, label]) => (
          <div key={label}>
            <p
              className="font-mono tabular-nums text-white"
              style={{ fontSize: "2.5rem", letterSpacing: "-0.04em" }}
            >
              {n}
            </p>
            <p className="mt-1 text-[0.8125rem] leading-snug text-[#626871]">
              {label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────  split ── */

const SECTIONS = [
  {
    kicker: "Hybrid retrieval",
    title: "One retriever always misses.",
    body: "Vector search fails on error codes, SKUs and version strings — those tokens barely exist in embedding space. Keyword search fails on paraphrase. Atlas runs both and fuses the rankings, so a passage found by only one channel still competes.",
    accent: "#6572e8",
  },
  {
    kicker: "Permissions",
    title: "Filtered before ranking, not after.",
    body: "Your group keys go inside both index scans. A post-filter lets an inaccessible chunk consume a slot in the shortlist and quietly cost you recall on the rows you were allowed to see. There is no path here that ranks a row you cannot read.",
    accent: "#d99a4e",
  },
  {
    kicker: "Ingestion",
    title: "Nothing is embedded twice.",
    body: "Every document carries a content hash and three pipeline versions. An unchanged file is skipped outright; a new embedding model recomputes vectors in place without re-chunking. That is the difference between a repo sync costing cents and costing hundreds.",
    accent: "#4ea67a",
  },
];

function Split() {
  return (
    <section className="px-6 py-28">
      <div className="mx-auto max-w-[1240px]">
        <h2
          className="max-w-[16ch] font-semibold text-white"
          style={{
            fontSize: "clamp(1.9rem, 4vw, 3.1rem)",
            lineHeight: 1.03,
            letterSpacing: "-0.035em",
          }}
        >
          Built for the questions that break RAG demos
        </h2>

        <div className="mt-16 grid gap-px bg-[rgba(255,255,255,0.05)] lg:grid-cols-3">
          {SECTIONS.map((s) => (
            <article key={s.kicker} className="bg-black px-7 py-9">
              <div className="flex items-center gap-2">
                <span
                  className="h-[3px] w-6 rounded-full"
                  style={{ background: s.accent }}
                />
                <span className="font-mono text-[0.6875rem] uppercase tracking-[0.11em] text-[#626871]">
                  {s.kicker}
                </span>
              </div>
              <h3 className="mt-5 text-[1.25rem] font-medium leading-[1.25] tracking-[-0.02em] text-white">
                {s.title}
              </h3>
              <p className="mt-3 text-[0.875rem] leading-[1.7] text-[#8a9099]">
                {s.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────  closer ── */

function Closer() {
  return (
    <section className="relative overflow-hidden border-t border-[rgba(255,255,255,0.05)] px-6 py-32">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[420px]"
        style={{
          background:
            "radial-gradient(46rem 20rem at 50% 100%, rgba(101,114,232,0.13), transparent 68%)",
        }}
      />
      <div className="relative mx-auto max-w-[1240px] text-center">
        <h2
          className="mx-auto max-w-[15ch] font-semibold text-white"
          style={{
            fontSize: "clamp(2.1rem, 5vw, 3.8rem)",
            lineHeight: 1.0,
            letterSpacing: "-0.04em",
          }}
        >
          Stop guessing why it answered that
        </h2>
        <p className="mx-auto mt-6 max-w-[44ch] text-[1rem] leading-[1.65] text-[#8a9099]">
          Every answer ships with the passages behind it and the ranking that
          chose them.
        </p>
        <Link
          href="/ask"
          className="mt-9 inline-block rounded-full bg-white px-6 py-3 text-[0.9375rem] font-medium text-black transition-opacity duration-150 hover:opacity-85"
        >
          Open Atlas
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[rgba(255,255,255,0.05)] px-6 py-9">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Mark size={16} />
          <span className="text-[0.8125rem] text-[#626871]">
            Atlas — permission-aware hybrid retrieval
          </span>
        </div>
        <div className="flex gap-6">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[0.8125rem] text-[#626871] transition-colors hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
