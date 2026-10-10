import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { signToken } from "../auth.js";
import { pool } from "../db.js";
import { HttpError } from "../errors.js";
import { asyncRoute } from "../http.js";
import { verifyGoogleCode } from "../services/googleAuth.js";
import { checkOtp, isPlayReviewPhone, sendOtp } from "../services/otp.js";
import { sendVerificationEmail, verificationPage } from "../services/resend.js";

const credentials = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(6).max(72),
  full_name: z.string().trim().max(120).optional(),
});

const VERIFY_HOURS = 24;

function emailOf(value: string) {
  return value.trim().toLowerCase();
}

function apiPublicBase(req: Request) {
  const configured = process.env.API_PUBLIC_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const host = req.header("x-forwarded-host") || req.get("host");
  const proto = (req.header("x-forwarded-proto") || req.protocol || "http").split(",")[0]?.trim();
  return `${proto}://${host}`;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function sendVerificationLink(accountId: string, email: string, name: string | null, linkBase: string) {
  const recent = await pool.query<{ id: string }>(
    `SELECT id FROM public.email_verifications
     WHERE account_id = $1 AND used_at IS NULL AND created_at > now() - interval '60 seconds'
     LIMIT 1`,
    [accountId]
  );
  if (recent.rows[0]) return false;

  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  await pool.query(
    `INSERT INTO public.email_verifications (account_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(hours => $3::int))`,
    [accountId, hash, VERIFY_HOURS]
  );
  const verifyUrl = `${linkBase}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  try {
    await sendVerificationEmail({ to: email, name, verifyUrl });
  } catch (error) {
    await pool.query(`DELETE FROM public.email_verifications WHERE token_hash = $1`, [hash]);
    throw error;
  }
  await pool.query(
    `UPDATE public.email_verifications SET used_at = now()
     WHERE account_id = $1 AND used_at IS NULL AND token_hash <> $2`,
    [accountId, hash]
  );
  console.log(`Verification email sent to ${email}`);
  return true;
}

const sentMessage = "We sent a verification link to your email. Open it, then come back and log in.";

export const AuthController = {
  signup: asyncRoute(async (req, res) => {
    const body = credentials.parse(req.body);
    const email = emailOf(body.email);
    const existing = await pool.query<{ id: string; password_set: boolean; email_verified: boolean }>(
      `SELECT id, password_set, email_verified FROM public.accounts WHERE lower(email) = $1`,
      [email]
    );
    const current = existing.rows[0];
    if (current?.password_set && current.email_verified) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    if (current && !current.password_set) {
      res.status(409).json({ error: "This email already uses Google. Continue with Google." });
      return;
    }

    const id = current?.id || randomUUID();
    const passwordHash = await bcrypt.hash(body.password, 10);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (current) {
        await client.query(
          `UPDATE public.accounts
           SET email = $2, password_hash = $3, password_set = true, email_verified = false
           WHERE id = $1`,
          [id, email, passwordHash]
        );
      } else {
        await client.query(
          `INSERT INTO public.accounts (id, email, password_hash, password_set, email_verified)
           VALUES ($1, $2, $3, true, false)`,
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

    await sendVerificationLink(id, email, body.full_name || null, apiPublicBase(req));
    res.status(201).json({ verification_required: true, message: sentMessage });
  }),

  resendVerification: asyncRoute(async (req, res) => {
    const email = emailOf(z.string().trim().email().parse(req.body?.email));
    const existing = await pool.query<{ id: string; password_set: boolean; email_verified: boolean; full_name: string | null }>(
      `SELECT a.id, a.password_set, a.email_verified, p.full_name
       FROM public.accounts a
       LEFT JOIN public.user_profiles p ON p.id = a.id
       WHERE lower(a.email) = $1`,
      [email]
    );
    const account = existing.rows[0];
    if (account?.password_set && !account.email_verified) {
      const sent = await sendVerificationLink(account.id, email, account.full_name, apiPublicBase(req));
      if (!sent) {
        res.json({ message: "A verification link was just sent. Check your inbox, including spam." });
        return;
      }
    }
    res.json({ message: sentMessage });
  }),

  verifyEmail: asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    const raw = req.query.token;
    const token = typeof raw === "string" ? raw : "";
    const invalid = () => {
      res.status(400).type("html").send(verificationPage(
        "Link not valid",
        "This verification link is not valid. Go back to the app and tap Resend verification email."
      ));
    };
    if (!token || token.length < 20 || token.length > 200) {
      invalid();
      return;
    }

    const found = await pool.query<{ id: string; account_id: string; expires_at: Date; email_verified: boolean }>(
      `SELECT v.id, v.account_id, v.expires_at, a.email_verified
       FROM public.email_verifications v
       JOIN public.accounts a ON a.id = v.account_id
       WHERE v.token_hash = $1`,
      [tokenHash(token)]
    );
    const row = found.rows[0];
    if (!row) {
      invalid();
      return;
    }
    if (row.email_verified) {
      res.type("html").send(verificationPage(
        "Email verified",
        "This email is already verified. Close this page, go back to PropertySetu, and log in.",
        true
      ));
      return;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      res.status(400).type("html").send(verificationPage(
        "Link expired",
        "This verification link has expired. Go back to the app and tap Resend verification email."
      ));
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE public.accounts SET email_verified = true, email_verified_at = now() WHERE id = $1`,
        [row.account_id]
      );
      await client.query(
        `UPDATE public.email_verifications SET used_at = COALESCE(used_at, now()) WHERE account_id = $1 AND used_at IS NULL`,
        [row.account_id]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.type("html").send(verificationPage(
      "Email verified",
      "Your email is verified. Close this page, go back to PropertySetu, and log in.",
      true
    ));
  }),

  login: asyncRoute(async (req, res) => {
    const body = z.object({
      email: z.string().trim().email().max(160).optional(),
      phone: z.string().trim().regex(/^\d{10}$/, "Valid 10-digit phone number required").optional(),
      password: z.string().min(6).max(72),
    }).refine((value) => Boolean(value.email || value.phone), { message: "Mobile number or email is required" }).parse(req.body);
    const result = await pool.query<{
      id: string;
      email: string | null;
      phone: string | null;
      password_hash: string;
      password_set: boolean;
      email_verified: boolean;
    }>(
      `SELECT id, email, phone, password_hash, password_set, email_verified
       FROM public.accounts
       WHERE ($1::text IS NOT NULL AND (phone = $1 OR phone = '+91' || $1 OR email = $1))
          OR ($2::text IS NOT NULL AND lower(email) = $2)
       ORDER BY CASE WHEN phone = $1 THEN 0 ELSE 1 END
       LIMIT 1`,
      [body.phone ?? null, body.email ? emailOf(body.email) : null]
    );
    const account = result.rows[0];
    if (account && !account.password_set && !body.phone) {
      throw new HttpError(401, "This email uses Google. Continue with Google.");
    }
    let matches = false;
    if (account?.password_set) {
      try {
        matches = await bcrypt.compare(body.password, account.password_hash);
      } catch {
        matches = false;
      }
    }
    if (!account || !matches) {
      res.status(401).json({ error: body.phone ? "Mobile number or password is incorrect" : "Email or password is incorrect" });
      return;
    }
    const emailLogin = Boolean(body.email) && account.email?.includes("@");
    if (emailLogin && !account.email_verified) {
      throw new HttpError(403, "Verify your email before you log in. Open the link we sent you.", "email_not_verified");
    }
    const user = { id: account.id, email: account.email, phone: account.phone };
    res.json({ token: signToken(user), user });
  }),

  google: asyncRoute(async (req, res) => {
    const body = z.object({
      code: z.string().trim().min(8).max(2048),
      code_verifier: z.string().trim().min(20).max(256),
      redirect_uri: z.string().trim().min(8).max(500),
      client_id: z.string().trim().min(10).max(256),
    }).parse(req.body);
    const profile = await verifyGoogleCode({
      code: body.code,
      codeVerifier: body.code_verifier,
      redirectUri: body.redirect_uri,
      clientId: body.client_id,
    });
    const email = emailOf(profile.email);
    const fullName = profile.name;
    const existing = await pool.query<{ id: string }>(`SELECT id FROM public.accounts WHERE lower(email) = $1`, [email]);
    const id = existing.rows[0]?.id || randomUUID();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (!existing.rows[0]) {
        const passwordHash = await bcrypt.hash(randomUUID(), 10);
        await client.query(
          `INSERT INTO public.accounts (id, email, password_hash, password_set, email_verified, email_verified_at)
           VALUES ($1, $2, $3, false, true, now())`,
          [id, email, passwordHash]
        );
      } else {
        await client.query(
          `UPDATE public.accounts
           SET email_verified = true, email_verified_at = COALESCE(email_verified_at, now())
           WHERE id = $1`,
          [id]
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
    if (!body.create && !existing.rows[0] && !isPlayReviewPhone(body.phone)) {
      throw new HttpError(404, "No account for this number. Create an account.", "account_not_found");
    }
    const sessionId = await sendOtp(body.phone);
    res.json({ message: "OTP sent successfully", sessionId });
  }),

  verifyOtp: asyncRoute(async (req, res) => {
    const body = z.object({
      phone: z.string().trim().regex(/^\d{10}$/, "Valid 10-digit phone number required"),
      otp: z.string().trim().regex(/^\d{4,8}$/, "Enter the OTP"),
      sessionId: z.string().trim().min(4).max(200),
      create: z.boolean(),
      full_name: z.string().trim().min(2).max(80).optional(),
    }).parse(req.body);
    const reviewName = isPlayReviewPhone(body.phone) ? "Play Reviewer" : "";
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

  googleCallback: (req: Request, res: Response) => {
    const state = typeof req.query.state === "string" ? req.query.state : "";
    let returnUrl = "";
    try {
      const protocol = new URL(state).protocol;
      if (protocol === "exp:" || protocol === "exps:" || protocol === "propertyhub:") returnUrl = state;
    } catch {
      returnUrl = "";
    }
    if (!returnUrl) {
      res.status(400).send("Google sign-in could not return to the app.");
      return;
    }
    const target = new URL(returnUrl);
    for (const key of ["code", "error", "error_description"] as const) {
      const value = req.query[key];
      if (typeof value === "string" && value) target.searchParams.set(key, value);
    }
    target.searchParams.set("state", state);
    res.redirect(target.toString());
  },
};
