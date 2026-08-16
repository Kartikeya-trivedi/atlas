"use client";

import { useEffect, useRef, useState } from "react";
import { search } from "@/lib/api";
import type { RetrievalParams, RetrievalTrace } from "@/lib/types";

const EMPTY: RetrievalTrace = {
  query: "",
  params: {} as RetrievalParams,
  dense: [],
  sparse: [],
  fused: [],
  timings: { embedMs: 0, denseMs: 0, sparseMs: 0, fuseMs: 0 },
  contextTokens: 0,
};

/**
 * Debounced retrieval for the playground.
 *
 * Every keystroke and every slider nudge would otherwise be an embedding call
 * plus a database round trip. The previous request is aborted rather than
 * awaited, so a fast typist never sees results from a query they have already
 * moved past.
 */
export function useSearch(query: string, params: RetrievalParams, delay = 300) {
  const [trace, setTrace] = useState<RetrievalTrace>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      abortRef.current?.abort();
      setTrace({ ...EMPTY, params });
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const next = await search(q, params, controller.signal);
        if (controller.signal.aborted) return;
        setTrace(next);
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Search failed.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [query, params, delay]);

  // Abort whatever is in flight when the view unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { trace, loading, error };
}
