import dotenv from "dotenv";
import pg from "pg";
import { pgConfig } from "./pgConfig.js";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({ ...pgConfig(), max: 10 });

export async function checkConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query<{ now: Date }>("SELECT now() AS now");
    return result.rows[0]?.now;
  } finally {
    client.release();
  }
}

export type Db = pg.PoolClient;

/**
 * Runs queries as the Supabase `authenticated` or `anon` role so Row Level Security applies.
 * The pool logs in as the database owner, which bypasses RLS, so every request switches role.
 */
export async function withDb<T>(userId: string | null, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO public");
    if (userId) {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await client.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)");
      await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
    } else {
      await client.query("SET LOCAL ROLE anon");
      await client.query("SELECT set_config('request.jwt.claim.sub', '', true)");
      await client.query("SELECT set_config('request.jwt.claim.role', 'anon', true)");
      await client.query(`SELECT set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    }
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already failed */
    }
    throw error;
  } finally {
    client.release();
  }
}
