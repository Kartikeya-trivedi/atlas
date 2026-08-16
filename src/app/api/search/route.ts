import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/server/http";
import { parseParams, parseQuery } from "@/lib/server/params";
import { resolveGenerationModel } from "@/lib/server/gemini";
import { hybridSearch } from "@/lib/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/search — retrieval without generation.
 *
 * What the playground calls on every keystroke. No rewrite here even when the
 * parameter is on: the point of that view is to see what the query you typed
 * actually retrieves, and silently searching for something else would make the
 * two columns impossible to reason about.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const query = parseQuery(body.query);
    const params = parseParams(body.params);

    if (!query) {
      return NextResponse.json({
        trace: {
          query: "",
          params,
          dense: [],
          sparse: [],
          fused: [],
          timings: { embedMs: 0, denseMs: 0, sparseMs: 0, fuseMs: 0 },
          contextTokens: 0,
        },
      });
    }

    const trace = await hybridSearch({
      query,
      params,
      documentIds: Array.isArray(body.documentIds) ? body.documentIds : undefined,
      generationModel: resolveGenerationModel(body.settings?.generationModel),
      signal: request.signal,
    });

    return NextResponse.json({ trace });
  } catch (err) {
    return errorResponse(err);
  }
}
