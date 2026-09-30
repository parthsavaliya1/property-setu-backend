import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { signToken } from "../auth.js";
import { pool } from "../db.js";
import { asyncRoute } from "../http.js";

const credentials = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(6).max(72),
  full_name: z.string().trim().max(120).optional(),
});

function emailOf(value: string) {
  return value.trim().toLowerCase();
}

export const AuthController = {
  signup: asyncRoute(async (req, res) => {
    const body = credentials.parse(req.body);
    const email = emailOf(body.email);
    const existing = await pool.query<{ id: string; password_set: boolean }>(
      `SELECT id, password_set FROM public.accounts WHERE lower(email) = $1`,
      [email]
    );
    const current = existing.rows[0];
    if (current?.password_set) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    const id = current?.id || randomUUID();
    const passwordHash = await bcrypt.hash(body.password, 10);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (current) {
        await client.query(
          `UPDATE public.accounts SET email = $2, password_hash = $3, password_set = true WHERE id = $1`,
          [id, email, passwordHash]
        );
      } else {
        await client.query(
          `INSERT INTO public.accounts (id, email, password_hash, password_set) VALUES ($1, $2, $3, true)`,
          [id, email, passwordHash]
        );
      }
      await client.query(
        `INSERT INTO public.user_profiles (id, full_name, email) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET full_name = COALESCE(EXCLUDED.full_name, user_profiles.full_name), email = EXCLUDED.email`,
        [id, body.full_name || null, email]
      );
      await client.query(
        `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'buyer') ON CONFLICT DO NOTHING`,
        [id]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const user = { id, email };
    res.status(201).json({ token: signToken(user), user });
  }),

  login: asyncRoute(async (req, res) => {
    const body = credentials.omit({ full_name: true }).parse(req.body);
    const email = emailOf(body.email);
    const result = await pool.query<{ id: string; email: string; password_hash: string }>(
      `SELECT id, email, password_hash FROM public.accounts WHERE lower(email) = $1`,
      [email]
    );
    const account = result.rows[0];
    let matches = false;
    if (account) {
      try {
        matches = await bcrypt.compare(body.password, account.password_hash);
      } catch {
        matches = false;
      }
    }
    if (!account || !matches) {
      res.status(401).json({ error: "Email or password is incorrect" });
      return;
    }
    const user = { id: account.id, email: account.email };
    res.json({ token: signToken(user), user });
  }),

  google: asyncRoute(async (req, res) => {
    const accessToken = z.string().min(20).parse(req.body?.access_token);
    const supabaseUrl = process.env.SUPABASE_URL || "https://zjjjifzkwdlmhwmupmhj.supabase.co";
    const anonKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqamppZnprd2RsbWh3bXVwbWhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NTg3MTQsImV4cCI6MjEwNjIzNDcxNH0.OKp6GukRvQXPJmR8K3vjhQ_OnQ67VU5YAZncOkWGCPc";
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, apikey: anonKey },
    });
    if (!response.ok) {
      res.status(401).json({ error: "Google sign-in could not be verified." });
      return;
    }
    const profile = (await response.json()) as {
      email?: string | null;
      app_metadata?: { provider?: string };
      user_metadata?: { full_name?: string; name?: string };
      identities?: Array<{ provider?: string }>;
    };
    const providers = (profile.identities || []).map((item) => item.provider);
    const isGoogle = profile.app_metadata?.provider === "google" || providers.includes("google");
    if (!isGoogle) {
      res.status(401).json({ error: "Sign in with Google." });
      return;
    }
    const email = emailOf(profile.email || "");
    if (!email.includes("@")) {
      res.status(400).json({ error: "Google did not share an email address." });
      return;
    }
    const fullName = profile.user_metadata?.full_name || profile.user_metadata?.name || "";
    const existing = await pool.query<{ id: string }>(`SELECT id FROM public.accounts WHERE lower(email) = $1`, [email]);
    const id = existing.rows[0]?.id || randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!existing.rows[0]) {
        const passwordHash = await bcrypt.hash(randomUUID(), 10);
        await client.query(
          `INSERT INTO public.accounts (id, email, password_hash, password_set) VALUES ($1, $2, $3, false)`,
          [id, email, passwordHash]
        );
      }
      await client.query(
        `INSERT INTO public.user_profiles (id, full_name, email) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET full_name = COALESCE(NULLIF(user_profiles.full_name, ''), EXCLUDED.full_name), email = EXCLUDED.email`,
        [id, fullName || null, email]
      );
      await client.query(
        `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'buyer') ON CONFLICT DO NOTHING`,
        [id]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const user = { id, email };
    res.json({ token: signToken(user), user });
  }),
};
