"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  deleteDocument,
  fetchDocuments,
  fetchHealth,
  type HealthStatus,
} from "./api";
import {
  DEFAULT_MODEL_SETTINGS,
  DEFAULT_PARAMS,
  type DocumentRecord,
  type ModelSettings,
  type RetrievalParams,
} from "./types";

/**
 * One shared store for the retrieval parameters, model settings and corpus.
 * The parameters are deliberately global: tuning them in the playground and
 * then asking a question in the console is the core workflow, and it would be
 * confusing if the two views disagreed.
 *
 * The corpus is server state. It is polled — not subscribed — while anything is
 * mid-ingest, because the stage and progress columns are written by a worker in
 * a different request than the one the browser is holding.
 */

const POLL_MS = 1_200;

interface ConsoleState {
  params: RetrievalParams;
  setParam: <K extends keyof RetrievalParams>(
    key: K,
    value: RetrievalParams[K],
  ) => void;
  resetParams: () => void;

  settings: ModelSettings;
  setSetting: <K extends keyof ModelSettings>(
    key: K,
    value: ModelSettings[K],
  ) => void;

  documents: DocumentRecord[];
  /** Null until the first fetch resolves. */
  corpusError: string | null;
  corpusLoading: boolean;
  refreshCorpus: () => Promise<void>;
  addDocuments: (docs: DocumentRecord[]) => void;
  updateDocument: (id: string, patch: Partial<DocumentRecord>) => void;
  removeDocument: (id: string) => void;

  /** Server configuration, for the settings screen. Null while loading. */
  health: HealthStatus | null;
  refreshHealth: () => Promise<void>;
}

const Ctx = createContext<ConsoleState | null>(null);

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useState<RetrievalParams>(DEFAULT_PARAMS);
  const [settings, setSettings] = useState<ModelSettings>(DEFAULT_MODEL_SETTINGS);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [corpusError, setCorpusError] = useState<string | null>(null);
  const [corpusLoading, setCorpusLoading] = useState(true);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const inFlight = useRef(false);
  const modelSynced = useRef(false);

  const setParam = useCallback<ConsoleState["setParam"]>((key, value) => {
    setParams((p) => ({ ...p, [key]: value }));
  }, []);

  const resetParams = useCallback(() => setParams(DEFAULT_PARAMS), []);

  const setSetting = useCallback<ConsoleState["setSetting"]>((key, value) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  const refreshCorpus = useCallback(async () => {
    // A slow poll must not stack up behind itself.
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setDocuments(await fetchDocuments());
      setCorpusError(null);
    } catch (err) {
      setCorpusError(err instanceof Error ? err.message : "Could not load the corpus.");
    } finally {
      inFlight.current = false;
      setCorpusLoading(false);
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const status = await fetchHealth();
      setHealth(status);

      // Adopt the server's GEMINI_MODEL the first time we hear from it, so the
      // dropdown reflects what an unmodified request would actually use. Only
      // while it still holds the compiled-in default — never clobber a choice.
      if (!modelSynced.current) {
        modelSynced.current = true;
        setSettings((s) =>
          s.generationModel === DEFAULT_MODEL_SETTINGS.generationModel &&
          status.generationModel !== s.generationModel
            ? { ...s, generationModel: status.generationModel }
            : s,
        );
      }
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    void refreshCorpus();
    void refreshHealth();
  }, [refreshCorpus, refreshHealth]);

  // Poll only while the pipeline has something in it.
  const working = documents.some((d) => d.stage !== "ready" && d.stage !== "failed");
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void refreshCorpus(), POLL_MS);
    return () => clearInterval(timer);
  }, [working, refreshCorpus]);

  const addDocuments = useCallback((docs: DocumentRecord[]) => {
    setDocuments((d) => [...docs, ...d.filter((x) => !docs.some((n) => n.id === x.id))]);
  }, []);

  const updateDocument = useCallback(
    (id: string, patch: Partial<DocumentRecord>) => {
      setDocuments((d) => d.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)));
    },
    [],
  );

  const removeDocument = useCallback(
    (id: string) => {
      // Optimistic: the row disappears immediately and comes back if the
      // delete failed, which reads better than a table that freezes.
      const previous = documents;
      setDocuments((d) => d.filter((doc) => doc.id !== id));
      void deleteDocument(id).catch((err: unknown) => {
        setDocuments(previous);
        setCorpusError(
          err instanceof Error ? err.message : "Could not delete that document.",
        );
      });
    },
    [documents],
  );

  const value = useMemo(
    () => ({
      params,
      setParam,
      resetParams,
      settings,
      setSetting,
      documents,
      corpusError,
      corpusLoading,
      refreshCorpus,
      addDocuments,
      updateDocument,
      removeDocument,
      health,
      refreshHealth,
    }),
    [
      params,
      setParam,
      resetParams,
      settings,
      setSetting,
      documents,
      corpusError,
      corpusLoading,
      refreshCorpus,
      addDocuments,
      updateDocument,
      removeDocument,
      health,
      refreshHealth,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConsole(): ConsoleState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConsole must be used inside <ConsoleProvider>");
  return ctx;
}
