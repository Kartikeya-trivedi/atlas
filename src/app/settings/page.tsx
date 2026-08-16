"use client";

import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Select, Slider, Toggle } from "@/components/ui/Controls";
import { compact } from "@/lib/format";
import { useConsole } from "@/lib/store";

const GEN_MODELS = [
  { value: "gemini-2.0-flash", label: "gemini-2.0-flash", note: "fast, 1M ctx" },
  { value: "gemini-2.0-flash-lite", label: "gemini-2.0-flash-lite", note: "cheapest" },
  { value: "gemini-2.5-flash", label: "gemini-2.5-flash", note: "stronger" },
  { value: "gemini-2.5-flash-lite", label: "gemini-2.5-flash-lite", note: "cheap, newer" },
  { value: "gemini-2.5-pro", label: "gemini-2.5-pro", note: "strongest" },
];

export default function SettingsPage() {
  const { settings, setSetting, health } = useConsole();

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-7">
        <header className="animate-rise mb-7">
          <h1 className="font-display text-[32px] leading-none text-bone-100">
            Settings
          </h1>
          <p className="mt-2.5 max-w-lg text-[13px] leading-relaxed text-bone-400">
            Model selection and grounding behaviour. Retrieval parameters live
            in the{" "}
            <a
              href="/playground"
              className="text-dense underline decoration-dense/40 underline-offset-2 hover:decoration-dense"
            >
              retrieval playground
            </a>
            , where you can see what they do.
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* ---- generation ---- */}
          <Panel label="generation" className="h-fit">
            <div className="space-y-4 p-3.5">
              <Select
                label="model"
                value={settings.generationModel}
                options={GEN_MODELS}
                onChange={(v) => setSetting("generationModel", v)}
              />

              <Slider
                label="temperature"
                value={settings.temperature}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => setSetting("temperature", v)}
                format={(v) => v.toFixed(2)}
                hint="Keep this low for grounded answering. Above ~0.4 the model starts smoothing over gaps in the context instead of admitting them."
              />

              <Slider
                label="max output tokens"
                value={settings.maxOutputTokens}
                min={256}
                max={8192}
                step={256}
                onChange={(v) => setSetting("maxOutputTokens", v)}
                format={(v) => v.toLocaleString()}
                accent="var(--color-bone-200)"
              />

              <div className="border-t border-ink-800 pt-3.5">
                <Toggle
                  label="strict grounding"
                  checked={settings.strictGrounding}
                  onChange={(v) => setSetting("strictGrounding", v)}
                  accent="var(--color-signal)"
                  hint="Decline to answer when fusion returns nothing above the score cutoff, rather than answering from parametric memory."
                />
              </div>
            </div>
          </Panel>

          {/* ---- embeddings ---- */}
          <Panel label="embeddings" className="h-fit">
            <div className="p-3.5">
              <p className="text-[12.5px] leading-relaxed text-bone-400">
                Set on the server, not here. The output dimensionality has to
                match the{" "}
                <code className="font-mono text-bone-200">vector(N)</code> column
                exactly, so changing it from the browser would only ever produce
                insert failures — edit{" "}
                <code className="font-mono text-bone-200">.env.local</code> and
                re-embed instead.
              </p>

              <dl className="mt-3 space-y-1.5 border-t border-ink-800 pt-3">
                <Meta k="model" v={health?.embedModel ?? "…"} />
                <Meta k="output dimensionality" v={health ? String(health.embedDim) : "…"} />
                <Meta k="document task type" v="RETRIEVAL_DOCUMENT" />
                <Meta k="query task type" v="RETRIEVAL_QUERY" />
                <Meta k="batch size" v="100 inputs / request" />
                <Meta k="distance operator" v="<=> (cosine)" />
              </dl>

              <p className="mt-3 text-[11.5px] leading-snug text-bone-500">
                Truncated Matryoshka outputs come back unnormalised — popo scales
                every vector to unit length before storing it.
              </p>
            </div>
          </Panel>

          {/* ---- prompt ---- */}
          <Panel label="system prompt" className="lg:col-span-2">
            <div className="p-3.5">
              <textarea
                value={settings.systemPrompt}
                onChange={(e) => setSetting("systemPrompt", e.target.value)}
                rows={4}
                className="scroll-thin w-full resize-y border border-ink-700 bg-ink-800 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-bone-200 transition-colors hover:border-ink-500 focus:border-dense/60 focus:outline-none"
              />
              <p className="mt-2 text-[11.5px] leading-snug text-bone-500">
                Citation rules are appended to this server-side, then the
                retrieved passages follow, each tagged with the bracketed marker
                the model must cite.
              </p>
            </div>
          </Panel>

          {/* ---- backend ---- */}
          <Panel label="backend" className="lg:col-span-2">
            <div className="p-3.5">
              <BackendStatus />

              <div className="mt-3.5 grid gap-x-6 gap-y-1.5 border-t border-ink-800 pt-3 sm:grid-cols-2">
                <Meta k="vector index" v="HNSW · m=16 · ef_construction=64" />
                <Meta k="lexical index" v="GIN on to_tsvector('english', …)" />
                <Meta k="fusion" v="weighted RRF, in-database" />
                <Meta k="isolation" v="service role only, tenant-filtered" />
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function BackendStatus() {
  const { health } = useConsole();

  if (!health) {
    return (
      <p className="flex items-center gap-2 text-[12.5px] text-bone-500">
        <Loader2 size={13} className="animate-spin" strokeWidth={1.8} />
        Checking the server…
      </p>
    );
  }

  if (!health.configured) {
    return (
      <Status tone="alert" title="Missing environment variables">
        <code className="font-mono">{health.missing.join(", ")}</code> — copy{" "}
        <code className="font-mono">.env.example</code> to{" "}
        <code className="font-mono">.env.local</code>, fill them in, and restart
        the dev server.
      </Status>
    );
  }

  if (!health.database.ok) {
    return (
      <Status tone="alert" title="Supabase unreachable">
        {health.database.error}
      </Status>
    );
  }

  return (
    <Status tone="ok" title="Connected">
      {compact(health.database.documents)} document
      {health.database.documents === 1 ? "" : "s"} ·{" "}
      {compact(health.database.chunks)} chunk
      {health.database.chunks === 1 ? "" : "s"} indexed · answering with{" "}
      <code className="font-mono">{health.generationModel}</code>
    </Status>
  );
}

function Status({
  tone,
  title,
  children,
}: {
  tone: "ok" | "alert";
  title: string;
  children: React.ReactNode;
}) {
  const ok = tone === "ok";
  return (
    <div
      className={
        ok
          ? "border border-signal/30 bg-signal/[0.05] px-3 py-2.5"
          : "border border-alert/35 bg-alert/[0.05] px-3 py-2.5"
      }
    >
      <p
        className={`flex items-center gap-2 text-[12.5px] ${
          ok ? "text-signal" : "text-alert"
        }`}
      >
        {ok ? (
          <CheckCircle2 size={13} className="shrink-0" strokeWidth={1.8} />
        ) : (
          <TriangleAlert size={13} className="shrink-0" strokeWidth={1.8} />
        )}
        {title}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-bone-400">{children}</p>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="label-micro">{k}</dt>
      <dd className="tabular truncate text-[11.5px] text-bone-300">{v}</dd>
    </div>
  );
}
