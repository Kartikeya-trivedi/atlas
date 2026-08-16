import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/server/env";
import { BadRequest, errorResponse } from "@/lib/server/http";
import { db } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DELETE /api/documents/:id — chunks go with it via ON DELETE CASCADE. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID.test(id)) throw new BadRequest("Not a document id.");

    const { error } = await db()
      .from("documents")
      .delete()
      .eq("id", id)
      .eq("tenant_id", serverConfig().tenantId);

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
