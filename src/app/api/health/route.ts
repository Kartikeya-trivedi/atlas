import { NextResponse } from "next/server";
import { configStatus, serverConfig } from "@/lib/server/env";
import { db } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — what the settings screen reports.
 *
 * Deliberately never throws. A half-configured install is the normal state on
 * first run, and the useful thing to render is which half is missing.
 */
export async function GET() {
  const config = configStatus();

  if (!config.configured) {
    return NextResponse.json({
      ...config,
      database: { ok: false, error: "Not configured." },
    });
  }

  try {
    const cfg = serverConfig();
    const client = db();

    const [docs, chunks] = await Promise.all([
      client
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", cfg.tenantId),
      client
        .from("chunks")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", cfg.tenantId),
    ]);

    const failure = docs.error ?? chunks.error;
    if (failure) {
      return NextResponse.json({
        ...config,
        database: {
          ok: false,
          error: `${failure.message}. Apply db/schema.sql to this project.`,
        },
      });
    }

    return NextResponse.json({
      ...config,
      database: {
        ok: true,
        documents: docs.count ?? 0,
        chunks: chunks.count ?? 0,
      },
    });
  } catch (err) {
    return NextResponse.json({
      ...config,
      database: {
        ok: false,
        error: err instanceof Error ? err.message : "Could not reach Supabase.",
      },
    });
  }
}
