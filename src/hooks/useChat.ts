"use client";

import { useCallback, useRef, useState } from "react";
import { chatStream } from "@/lib/api";
import type { Message, ModelSettings, RetrievalParams } from "@/lib/types";

/**
 * Drives one conversation against /api/chat.
 *
 * The route sends the retrieval trace before the first token, so the inspector
 * is populated while the answer is still streaming — attach it the moment it
 * lands rather than waiting for the message to finish.
 */
export function useChat(params: RetrievalParams, settings: ModelSettings) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Read inside send() without making it a dependency: re-creating send on
  // every token would remount the composer's handler mid-stream.
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const patch = useCallback((id: string, next: Partial<Message>) => {
    setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, ...next } : msg)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const query = text.trim();
      if (!query || busy) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);

      const history = messagesRef.current
        .filter((m) => !m.error && m.content)
        .map((m) => ({ role: m.role, content: m.content }));

      const stamp = Date.now();
      const assistantId = `a_${stamp}`;
      setMessages((m) => [
        ...m,
        { id: `u_${stamp}`, role: "user", content: query, createdAt: stamp },
        {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: stamp,
          streaming: true,
        },
      ]);

      try {
        let accumulated = "";

        for await (const event of chatStream(
          { query, params, settings, history },
          controller.signal,
        )) {
          switch (event.type) {
            case "trace":
              patch(assistantId, { trace: event.trace });
              break;

            case "delta":
              accumulated += event.text;
              patch(assistantId, { content: accumulated });
              break;

            case "done":
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === assistantId
                    ? {
                        ...msg,
                        content: event.content || accumulated,
                        citations: event.citations,
                        streaming: false,
                        error: event.error,
                        trace: msg.trace && {
                          ...msg.trace,
                          timings: {
                            ...msg.trace.timings,
                            generateMs: event.generateMs,
                          },
                        },
                      }
                    : msg,
                ),
              );
              break;

            case "error":
              patch(assistantId, { streaming: false, error: event.error });
              break;
          }
        }
      } catch (err) {
        // An abort is the user pressing stop, not a failure.
        if (!controller.signal.aborted) {
          patch(assistantId, {
            streaming: false,
            error: err instanceof Error ? err.message : "Request failed.",
          });
        }
      } finally {
        setMessages((m) =>
          m.map((msg) => (msg.streaming ? { ...msg, streaming: false } : msg)),
        );
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, params, settings, patch],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setMessages((m) =>
      m.map((msg) => (msg.streaming ? { ...msg, streaming: false } : msg)),
    );
    setBusy(false);
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setBusy(false);
  }, []);

  /** Most recent trace, for the inspector panel. */
  const lastTrace = [...messages].reverse().find((m) => m.trace)?.trace;

  return { messages, busy, send, stop, clear, lastTrace };
}
