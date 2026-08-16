import { Pool, types, type PoolClient } from "pg";
import { env } from "@/lib/core/env";

/**
 * The one Postgres pool. Server-only.
 *
 * Two type parsers are overridden because pg returns strings for anything that
 * might not survive a double, and silently stringly-typed money and counts
 * propagate a long way before they break something visible.
 */

// numeric/decimal → number. Ours are costs at 6dp; a float is exact enough.
types.setTypeParser(1700, (v) => Number.parseFloat(v));
// int8 → number. Job ids and counts; nowhere near Number.MAX_SAFE_INTEGER.
types.setTypeParser(20, (v) => Number.parseInt(v, 10));

let cached: Pool | null = null;

export function pool(): Pool {
  if (cached) return cached;
  const cfg = env();
  cached = new Pool({
    connectionString: cfg.DATABASE_URL,
    max: cfg.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Supabase's pooler presents a cert this chain does not verify against by
    // default. The connection is still encrypted.
    ssl: cfg.DATABASE_URL.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });

  // An idle-client error is emitted on the pool, not on a query. With no
  // listener it is an unhandled 'error' event and takes the process down.
  cached.on("error", (err) => {
    console.error("[atlas] idle client error:", err.message);
  });

  return cached;
}

export async function query<T extends object = Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await pool().query<T>(sql, params as unknown[]);
  return res.rows;
}

export async function one<T extends object = Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Runs `fn` in a transaction, rolling back on throw. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* connection already gone; the server rolls back for us */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * pgvector accepts its text input form over the wire. A JS array binds as a
 * Postgres array and fails to cast to vector, so build the literal explicitly.
 */
export function toVector(embedding: readonly number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function closePool(): Promise<void> {
  if (!cached) return;
  const p = cached;
  cached = null;
  await p.end();
}
