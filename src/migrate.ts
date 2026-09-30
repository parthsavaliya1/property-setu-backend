import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { pgConfig } from "./pgConfig.js";

const migrationsDir = path.resolve(import.meta.dirname, "../migrations");

/**
 * Records migrations that were applied before this runner existed.
 * A brand-new database has no properties table, so every file runs.
 */
async function baselineCutoff(client: pg.Client) {
  const found = await client.query<{ properties: string | null; accounts: string | null; wallets: string | null }>(
    `SELECT
       to_regclass('public.properties') AS properties,
       to_regclass('public.accounts') AS accounts,
       to_regclass('public.wallets') AS wallets`
  );
  const row = found.rows[0];
  if (!row?.properties) return null;
  if (row.wallets) return "034_wallets.sql";
  if (row.accounts) return "033_accounts.sql";
  return "032_auto_confirm_email.sql";
}

export async function runMigrations() {
  const client = new pg.Client(pgConfig());
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(842014)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query<{ filename: string }>("SELECT filename FROM public.schema_migrations");
    const done = new Set(applied.rows.map((row) => row.filename));
    const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

    if (done.size === 0) {
      const cutoff = await baselineCutoff(client);
      if (cutoff) {
        const recorded = files.filter((file) => file <= cutoff);
        for (const file of recorded) {
          await client.query(
            "INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
            [file]
          );
          done.add(file);
        }
        console.log(`Migrations: database already has tables. Recorded ${recorded.length} existing files.`);
      }
    }

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`Migration applied: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        const message = error instanceof Error ? error.message : "Migration failed";
        throw new Error(`Migration failed: ${file}. ${message}`);
      }
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(842014)");
    } catch {
      /* the connection may already be closed */
    }
    await client.end();
  }
}
