import { NextResponse } from "next/server";
import { rewriteQuery, streamAnswer } from "@/lib/server/gemini";
import { errorResponse } from "@/lib/server/http";
import {
  parseGenerationSettings,
  parseHistory,
  parseParams,
  parseQuery,
} from "@/lib/server/params";
import {
  buildContext,
  buildPrompt,
  buildSystemInstruction,
  extractCitations,
} from "@/lib/server/prompt";
import { hybridSearch } from "@/lib/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/chat — retrieve, then generate, as one NDJSON stream.
 *
 * One JSON object per line:
 *   {"type":"trace", trace}                  once, before the first token
 *   {"type":"delta", text}                   many
 *   {"type":"done",  content, citations, …}  once
 *   {"type":"error", error}                  instead of done
 *
 * The trace goes out before generation starts so the inspector fills in while
 * the answer is still being written — retrieval is the part worth watching.
 */

const REFUSAL =
  "Nothing in the corpus clears the current score threshold for this question.\n\n" +
  "Either the answer is not in these documents, or retrieval is too tight: try lowering " +
  "**min score**, raising **candidates**, or shifting **α** toward the keyword channel if " +
  "the question contains identifiers or exact strings.";

const UNGROUNDED_INSTRUCTION =
  "No passage from the user's corpus matched this question. Say that plainly in your " +
  "first sentence, then answer from general knowledge if you can, making clear that the " +
  "answer is not grounded in their documents. Do not invent citation markers.";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const query = parseQuery(body.query);
  if (!query) {
    return NextResponse.json({ error: "Empty query." }, { status: 400 });
  }

  let params: ReturnType<typeof parseParams>;
  let settings: ReturnType<typeof parseGenerationSettings>;
  try {
    params = parseParams(body.params);
    settings = parseGenerationSettings(body.settings);
  } catch (err) {
    // Missing configuration — surfaced as a normal response, not a stream.
    return errorResponse(err);
  }

  const history = parseHistory(body.history);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          closed = true; // client hung up mid-answer
        }
      };

      try {
        // --- query rewrite ---------------------------------------------------
        // Only with history to resolve against. On a first turn there is no
        // pronoun to expand, and a rewrite would just add a round trip.
        let rewritten: string | undefined;
        if (params.rewriteQuery && history.length > 0) {
          const out = await rewriteQuery(settings.model, query, history, request.signal);
          if (out && out !== query) rewritten = out;
        }

        // --- retrieve --------------------------------------------------------
        const trace = await hybridSearch({
          query,
          params,
          rewrittenQuery: rewritten,
          documentIds: Array.isArray(body.documentIds)
            ? (body.documentIds as string[])
            : undefined,
          generationModel: settings.model,
          signal: request.signal,
        });
        send({ type: "trace", trace });

        if (trace.fused.length === 0 && settings.strictGrounding) {
          // Refuse locally: no context means no grounded answer is possible,
          // and calling the model would only produce a fluent guess.
          send({ type: "delta", text: REFUSAL });
          send({ type: "done", content: REFUSAL, citations: [], generateMs: 0 });
          return;
        }

        // --- generate --------------------------------------------------------
        const { block, used } = buildContext(trace.fused);
        const grounded = used.length > 0;

        const started = performance.now();
        let answer = "";

        const generator = streamAnswer({
          model: settings.model,
          systemInstruction: grounded
            ? buildSystemInstruction(settings.systemPrompt, settings.strictGrounding)
            : UNGROUNDED_INSTRUCTION,
          prompt: grounded
            ? buildPrompt(rewritten ?? query, block)
            : `Question: ${query}`,
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
          signal: request.signal,
        });

        let finishReason: string | undefined;
        while (true) {
          const { value, done } = await generator.next();
          if (done) {
            finishReason = value.finishReason;
            break;
          }
          answer += value;
          send({ type: "delta", text: value });
        }

        send({
          type: "done",
          content: answer,
          citations: grounded ? extractCitations(answer, used) : [],
          generateMs: Math.round(performance.now() - started),
          error: finishReasonNote(finishReason),
        });
      } catch (err) {
        if (!request.signal.aborted) {
          console.error("[popo] chat failed:", err);
          send({
            type: "error",
            error: err instanceof Error ? err.message : "Generation failed.",
          });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by cancel() */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      // Stops nginx and friends from buffering the whole answer before flushing.
      "x-accel-buffering": "no",
    },
  });
}

function finishReasonNote(reason?: string): string | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case "MAX_TOKENS":
      return "Answer was cut off at the output token limit — raise it in settings.";
    case "SAFETY":
      return "Gemini stopped this response on a safety filter.";
    case "RECITATION":
      return "Gemini stopped this response: the output was too close to memorised text.";
    default:
      return `Generation stopped early (${reason}).`;
  }
}
