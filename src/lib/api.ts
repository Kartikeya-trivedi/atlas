import type {
  Citation,
  DocumentRecord,
  ModelSettings,
  RetrievalParams,
  RetrievalTrace,
} from "./types";

/**
 * Browser-side client for the route handlers.
 *
 * Everything the UI knows about the backend goes through here, which is what
 * keeps the Gemini and Supabase SDKs — and the service role key — out of the
 * client bundle entirely.
 */

async function unwrap<T>(request: Promise<Response>): Promise<T> {
  const res = await request;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------- health --- */

export interface HealthStatus {
  configured: boolean;
  missing: string[];
  generationModel: string;
  embedModel: string;
  embedDim: number;
  database:
    | { ok: true; documents: number; chunks: number }
    | { ok: false; error: string };
}

export function fetchHealth(): Promise<HealthStatus> {
  return unwrap<HealthStatus>(fetch("/api/health", { cache: "no-store" }));
}

/* ---------------------------------------------------------- documents --- */

export async function fetchDocuments(signal?: AbortSignal): Promise<DocumentRecord[]> {
  const { documents } = await unwrap<{ documents: DocumentRecord[] }>(
    fetch("/api/documents", { cache: "no-store", signal }),
  );
  return documents;
}

export async function uploadDocument(file: File): Promise<DocumentRecord> {
  const form = new FormData();
  form.append("file", file);
  const { document } = await unwrap<{ document: DocumentRecord }>(
    fetch("/api/documents", { method: "POST", body: form }),
  );
  return document;
}

export async function deleteDocument(id: string): Promise<void> {
  await unwrap<{ ok: true }>(
    fetch(`/api/documents/${id}`, { method: "DELETE" }),
  );
}

/* ------------------------------------------------------------- search --- */

export async function search(
  query: string,
  params: RetrievalParams,
  signal?: AbortSignal,
): Promise<RetrievalTrace> {
  const { trace } = await unwrap<{ trace: RetrievalTrace }>(
    fetch("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, params }),
      signal,
    }),
  );
  return trace;
}

/* --------------------------------------------------------------- chat --- */

export type ChatEvent =
  | { type: "trace"; trace: RetrievalTrace }
  | { type: "delta"; text: string }
  | {
      type: "done";
      content: string;
      citations: Citation[];
      generateMs: number;
      error?: string;
    }
  | { type: "error"; error: string };

export interface ChatRequest {
  query: string;
  params: RetrievalParams;
  settings: ModelSettings;
  history: { role: string; content: string }[];
}

/**
 * Streams NDJSON from /api/chat.
 *
 * A chunk boundary can land mid-line, so the tail of each read is held back
 * until its newline arrives — parsing eagerly here produces a truncated-JSON
 * error roughly whenever the answer is long enough to matter.
 */
export async function* chatStream(
  req: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        yield JSON.parse(line) as ChatEvent;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as ChatEvent;
  } finally {
    reader.cancel().catch(() => {});
  }
}
