import { NextResponse, after } from "next/server";
import { serverConfig } from "@/lib/server/env";
import { ACCEPTED_EXTENSIONS, kindFromName } from "@/lib/server/extract";
import { BadRequest, errorResponse } from "@/lib/server/http";
import { runIngest } from "@/lib/server/ingest";
import { db, toDocumentRecord, type DocumentRow } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Embedding a large PDF outlives a default serverless invocation. */
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** GET /api/documents — the corpus table, newest first. */
export async function GET() {
  try {
    const cfg = serverConfig();
    const { data, error } = await db()
      .from("documents")
      .select("*")
      .eq("tenant_id", cfg.tenantId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      throw new Error(
        `${error.message}. Has db/schema.sql been applied to this Supabase project?`,
      );
    }

    return NextResponse.json({
      documents: (data as DocumentRow[]).map(toDocumentRecord),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/documents — accepts one file, returns as soon as the row exists.
 *
 * The pipeline itself runs in after(), so the browser gets its optimistic row
 * immediately and watches the stages advance by polling GET, rather than
 * holding a connection open for the length of an embedding job.
 */
export async function POST(request: Request) {
  try {
    const cfg = serverConfig();

    const form = await request.formData().catch(() => {
      throw new BadRequest("Expected a multipart/form-data body with a `file` field.");
    });

    const file = form.get("file");
    if (!(file instanceof File)) throw new BadRequest("No `file` field in the upload.");
    if (file.size === 0) throw new BadRequest("That file is empty.");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequest(
        `That file is ${(file.size / 1024 ** 2).toFixed(1)} MB; the limit is ${
          MAX_UPLOAD_BYTES / 1024 ** 2
        } MB.`,
      );
    }

    const kind = kindFromName(file.name);
    if (!kind) {
      throw new BadRequest(
        `Unsupported file type. Accepted extensions: ${ACCEPTED_EXTENSIONS.join(", ")}.`,
      );
    }

    const title = file.name.replace(/\.[^.]+$/, "").trim() || file.name;

    const { data, error } = await db()
      .from("documents")
      .insert({
        tenant_id: cfg.tenantId,
        title,
        kind,
        size_bytes: file.size,
        stage: "queued",
        progress: 0,
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(
        `${error.message}. Has db/schema.sql been applied to this Supabase project?`,
      );
    }

    const row = data as DocumentRow;
    // Read the bytes before the request object goes out of scope.
    const bytes = await file.arrayBuffer();
    after(() => runIngest(row.id, title, kind, bytes));

    return NextResponse.json({ document: toDocumentRecord(row) }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
