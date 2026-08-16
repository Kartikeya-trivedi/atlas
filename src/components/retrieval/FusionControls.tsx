"use client";

import { useConsole } from "@/lib/store";
import { Slider, Toggle } from "@/components/ui/Controls";

/**
 * Every knob that changes what comes back from retrieval, in the order you
 * actually reach for them. Alpha first — it is the one that matters.
 */
export function FusionControls({ compactMode = false }: { compactMode?: boolean }) {
  const { params, setParam } = useConsole();

  // The alpha thumb takes the colour of whichever channel currently dominates,
  // so the control itself reports the balance without being read.
  const alphaAccent =
    params.alpha > 0.5
      ? "var(--color-dense)"
      : params.alpha < 0.5
        ? "var(--color-sparse)"
        : "var(--color-bone-200)";

  return (
    <div className="space-y-4">
      <Slider
        label="α  ·  channel weight"
        value={params.alpha}
        min={0}
        max={1}
        step={0.05}
        onChange={(v) => setParam("alpha", v)}
        format={(v) =>
          v === 0 ? "keyword only" : v === 1 ? "vector only" : v.toFixed(2)
        }
        accent={alphaAccent}
        ends={["← keyword", "vector →"]}
        hint="Weights each channel's contribution to the RRF sum. Push toward keyword for identifiers, error codes and exact strings; toward vector for paraphrased questions."
      />

      <Slider
        label="top k  ·  passages kept"
        value={params.topK}
        min={1}
        max={20}
        step={1}
        onChange={(v) => setParam("topK", v)}
        hint="How many fused passages reach the model. More context is not always better — irrelevant passages dilute attention."
      />

      <Slider
        label="candidates  ·  per channel"
        value={params.candidates}
        min={topKFloor(params.topK)}
        max={100}
        step={5}
        onChange={(v) => setParam("candidates", v)}
        hint="Rows pulled from each channel before fusion. Over-fetching lets a passage ranked 11th by one channel and 2nd by the other still win."
      />

      {!compactMode && (
        <>
          <Slider
            label="rrf k  ·  smoothing"
            value={params.rrfK}
            min={1}
            max={120}
            step={1}
            onChange={(v) => setParam("rrfK", v)}
            accent="var(--color-bone-200)"
            hint="Low k sharpens the top of the ranking and lets one confident channel dominate. 60 is the value from the original RRF paper."
          />

          <Slider
            label="min score  ·  cutoff"
            value={params.minScore}
            min={0}
            max={0.6}
            step={0.02}
            onChange={(v) => setParam("minScore", v)}
            format={(v) => (v === 0 ? "off" : v.toFixed(2))}
            accent="var(--color-caution)"
            hint="Drops weak fused rows entirely. With strict grounding on, an empty result makes the model decline to answer rather than improvise."
          />
        </>
      )}

      <div className="space-y-1.5 border-t border-ink-800 pt-3.5">
        <Toggle
          label="cross-encoder rerank"
          checked={params.rerank}
          onChange={(v) => setParam("rerank", v)}
          accent="var(--color-caution)"
          hint="Rescores the shortlist jointly. Markedly better ordering, ~200ms."
        />
        <Toggle
          label="llm query rewrite"
          checked={params.rewriteQuery}
          onChange={(v) => setParam("rewriteQuery", v)}
          hint="Expands pronouns and follow-ups into standalone queries."
        />
      </div>
    </div>
  );
}

/** Candidates below topK would silently truncate the fusion input. */
function topKFloor(topK: number) {
  return Math.max(5, Math.ceil(topK / 5) * 5);
}
