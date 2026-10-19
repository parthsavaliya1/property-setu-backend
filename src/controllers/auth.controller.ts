import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { signToken } from "../auth.js";
import { pool } from "../db.js";
import { HttpError } from "../errors.js";
import { asyncRoute } from "../http.js";
import { checkOtp, findActiveDemo, isPlayReviewPhone, sendOtp } from "../services/otp.js";

export const AuthController = {
  // The administrator website signs in with a mobile number and password.
  login: asyncRoute(async (req, res) => {
    const body = z.object({
      phone: z.string().trim().regex(/^\d{10}$/, "Valid 10-digit phone number required"),
      password: z.string().min(6).max(72),
    }).parse(req.body);
    const result = await pool.query<{ id: string; email: string | null; phone: string | null; password_hash: string; password_set: boolean }>(
      `SELECT id, email, phone, password_hash, password_set FROM public.accounts
       WHERE phone = $1 OR phone = '+91' || $1 OR email = $1
       ORDER BY CASE WHEN phone = $1 THEN 0 ELSE 1 END LIMIT 1`, [body.phone]
    );
    const account = result.rows[0];
    let matches = false;
    if (account?.password_set) {
      try { matches = await bcrypt.compare(body.password, account.password_hash); }
      catch { matches = false; }
    }
    if (!account || !matches) {
      res.status(401).json({ error: "Mobile number or password is incorrect" }); return;
    }
    const user = { id: account.id, email: account.email, phone: account.phone };
    res.json({ token: signToken(user), user });
  }),

  sendOtp: asyncRoute(async (req, res) => {
    const body = z.object({
      phone: z.string().trim().regex(/^\d{10}$/, "Valid 10-digit phone number required"),
      create: z.boolean(),
    }).parse(req.body);
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM public.accounts WHERE phone = $1`,
      [body.phone]
    );
    if (body.create && existing.rows[0]) {
      throw new HttpError(409, "This number already has an account. Log in.", "account_exists");
    }
    const demo = await findActiveDemo(body.phone);
    const fixedLogin = Boolean(demo) || isPlayReviewPhone(body.phone);
    if (!body.create && !existing.rows[0] && !fixedLogin) {
      throw new HttpError(404, "No account for this number. Create an account.", "account_not_found");
    }
    const sessionId = await sendOtp(body.phone);
    res.json({
      message: fixedLogin ? "Enter the demo OTP. No SMS was sent." : "OTP sent successfully",
      sessionId,
      demo: fixedLogin,
    });
  }),

  verifyOtp: asyncRoute(async (req, res) => {
    const body = z.object({
      phone: z.string().trim().regex(/^\d{10}$/, "Valid 10-digit phone number required"),
      otp: z.string().trim().regex(/^\d{4,8}$/, "Enter the OTP"),
      sessionId: z.string().trim().min(4).max(200),
      create: z.boolean(),
      full_name: z.string().trim().min(2).max(80).optional(),
    }).parse(req.body);
    const demo = await findActiveDemo(body.phone);
    const reviewName = isPlayReviewPhone(body.phone) ? "Play Reviewer" : (demo?.full_name || "");
    if (body.create && !body.full_name && !reviewName) {
      throw new HttpError(400, "Enter your name to create the account.", "name_required");
    }

    await checkOtp(body.phone, body.otp, body.sessionId);

    const existing = await pool.query<{ id: string; email: string | null }>(
      `SELECT id, email FROM public.accounts WHERE phone = $1`,
      [body.phone]
    );
    const current = existing.rows[0];
    if (body.create && current) {
      throw new HttpError(409, "This number already has an account. Log in.", "account_exists");
    }
    if (!body.create && !current && !reviewName) {
      throw new HttpError(404, "No account for this number. Create an account.", "account_not_found");
    }

    const id = current?.id || randomUUID();
    const accountName = body.full_name || reviewName;
    if (!current) {
      const passwordHash = await bcrypt.hash(randomUUID(), 10);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `INSERT INTO public.accounts (id, email, phone, password_hash, password_set, email_verified, email_verified_at)
           VALUES ($1, NULL, $2, $3, false, true, now())`,
          [id, body.phone, passwordHash]
        );
        await client.query(
          `INSERT INTO public.user_profiles (id, full_name, phone) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone`,
          [id, accountName, body.phone]
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
    }

    const user = { id, email: current?.email ?? null, phone: body.phone };
    res.json({ token: signToken(user), user, isNewUser: !current });
  }),

};
