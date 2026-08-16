import { chunkDocument } from "./chunk";
import { serverConfig } from "./env";
import { extractDocument, ExtractionError, type DocumentKind } from "./extract";
import { embedDocuments } from "./gemini";
import { db, toVectorLiteral } from "./supabase";

/**
 * The ingest worker: extract → chunk → contextualise → embed → index.
 *
 * Runs after the upload response has already been sent, writing its stage and
 * progress back to the documents row as it goes. The corpus table polls that
 * row, so the pipeline is visible while it happens rather than being a spinner
 * that either finishes or doesn't.
 */

/** Rows per insert. Large enough to matter, small enough to stay under the payload cap. */
const INSERT_BATCH = 200;

type Stage =
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexing"
  | "ready"
  | "failed";

async function setStage(
  id: string,
  stage: Stage,
  patch: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await db().from("documents").update({ stage, ...patch }).eq("id", id);
  if (error) console.error(`[popo] stage update failed (${id} -> ${stage})`, error);
}

export async function runIngest(
  documentId: string,
  title: string,
  kind: DocumentKind,
  bytes: ArrayBuffer,
): Promise<void> {
  const cfg = serverConfig();

  try {
    // --- extract ------------------------------------------------------------
    await setStage(documentId, "extracting", { progress: 0.05 });
    const pages = await extractDocument(bytes, kind);

    // --- chunk --------------------------------------------------------------
    await setStage(documentId, "chunking", { progress: 0.15 });
    const chunks = chunkDocument(title, pages);
    if (chunks.length === 0) {
      throw new ExtractionError("Extraction produced no chunks — the file appears empty.");
    }

    const tokenCount = chunks.reduce((s, c) => s + c.tokenCount, 0);
    await setStage(documentId, "embedding", {
      progress: 0,
      chunk_count: chunks.length,
      token_count: tokenCount,
    });

    // --- embed --------------------------------------------------------------
    // Batched inside embedDocuments; embedding a thousand chunks one at a time
    // is bounded by round-trip time, not by compute.
    const vectors = await embedDocuments(
      chunks.map((c) => c.embedText),
      async (done, total) => {
        await setStage(documentId, "embedding", { progress: done / total });
      },
    );

    // --- index --------------------------------------------------------------
    await setStage(documentId, "indexing", { progress: 0.9 });

    // Replace rather than append, so a re-ingest of the same document id cannot
    // leave the old chunks behind alongside the new ones.
    const { error: clearError } = await db()
      .from("chunks")
      .delete()
      .eq("document_id", documentId);
    if (clearError) throw new Error(`clearing old chunks: ${clearError.message}`);

    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const rows = chunks.slice(i, i + INSERT_BATCH).map((c, j) => ({
        document_id: documentId,
        tenant_id: cfg.tenantId,
        ordinal: c.ordinal,
        page: c.page,
        heading: c.heading,
        content: c.content,
        token_count: c.tokenCount,
        embedding: toVectorLiteral(vectors[i + j]),
      }));

      const { error } = await db().from("chunks").insert(rows);
      if (error) throw new Error(`inserting chunks: ${error.message}`);

      await setStage(documentId, "indexing", {
        progress: 0.9 + (0.1 * Math.min(i + INSERT_BATCH, chunks.length)) / chunks.length,
      });
    }

    await setStage(documentId, "ready", {
      progress: 1,
      chunk_count: chunks.length,
      token_count: tokenCount,
      error: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[popo] ingest failed for ${documentId}:`, err);
    await setStage(documentId, "failed", { error: message });
  }
}
