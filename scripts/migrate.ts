/**
 * Migration runner:  npm run db:migrate
 *
 * Applies db/migrations/*.sql in filename order, once each, inside a
 * transaction. Two guards matter:
 *
 *  - A session-level advisory lock, so two deploys racing to migrate serialise
 *    instead of both running CREATE INDEX against the same table.
 *  - A checksum per applied file. Editing a migration that has already run in
 *    some environment is the mistake that produces schema drift you discover
 *    months later; this turns it into an error at the next deploy.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import "dotenv/config";
import { closePool, pool } from "../src/lib/db/pool";

const DIR = join(process.cwd(), "db", "migrations");
const LOCK_KEY = 8_274_113_009; // arbitrary, stable

async function main(): Promise<void> {
  const client = await pool().connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);

    await client.query(`
      create table if not exists schema_migrations (
        version    text primary key,
        checksum   text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const applied = new Map<string, string>(
      (
        await client.query<{ version: string; checksum: string }>(
          "select version, checksum from schema_migrations",
        )
      ).rows.map((r) => [r.version, r.checksum]),
    );

    const files = (await readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();
    if (files.length === 0) throw new Error(`no .sql files in ${DIR}`);

    let ran = 0;
    for (const file of files) {
      const sql = await readFile(join(DIR, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex").slice(0, 16);
      const previous = applied.get(file);

      if (previous) {
        if (previous !== checksum) {
          throw new Error(
            `${file} has changed since it was applied (${previous} → ${checksum}). ` +
              `Add a new migration instead of editing an applied one.`,
          );
        }
        continue;
      }

      process.stdout.write(`  applying ${file} … `);
      const started = Date.now();
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query(
          "insert into schema_migrations (version, checksum) values ($1, $2)",
          [file, checksum],
        );
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        process.stdout.write("failed\n");
        throw err;
      }
      process.stdout.write(`ok (${Date.now() - started}ms)\n`);
      ran++;
    }

    console.log(
      ran === 0
        ? `Up to date — ${files.length} migration(s) already applied.`
        : `Applied ${ran} migration(s).`,
    );
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    client.release();
    await closePool();
  }
}

main().catch((err: unknown) => {
  console.error(`\nMigration failed: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
