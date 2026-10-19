import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { pool } from "../db.js";
import { HttpError } from "../errors.js";
import type { Db } from "../db.js";

type FactorResponse = {
  Status?: string;
  Details?: string;
};

function apiKey() {
  const key = process.env.TWO_FACTOR_API_KEY?.trim();
  if (!key) throw new HttpError(503, "OTP is not configured");
  return key;
}

async function factorGet(path: string) {
  const response = await fetch(`https://2factor.in/API/V1/${apiKey()}/${path}`, {
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json().catch(() => ({}))) as FactorResponse;
  return data;
}

export function isPlayReviewPhone(phone: string) {
  const configured = process.env.PLAY_REVIEW_PHONE?.trim();
  const otp = process.env.PLAY_REVIEW_OTP?.trim();
  return Boolean(configured && /^\d{10}$/.test(configured) && otp && /^\d{4,8}$/.test(otp) && phone === configured);
}

/** Active demo logins skip SMS. The OTP is the one saved in admin settings. */
export async function findActiveDemo(phone: string) {
  try {
    const result = await pool.query<{ otp: string; full_name: string }>(
      `SELECT otp, full_name FROM public.demo_users WHERE phone = $1 AND active = true LIMIT 1`,
      [phone]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return null;
    throw error;
  }
}

export function otpPhoneHash(phone: string) { return otpHash('phone:' + phone); }
function otpHash(value: string) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new HttpError(503, 'OTP verification is not configured');
  return createHmac('sha256', secret).update(value).digest('hex');
}
async function rememberOtp(phone: string, sessionId: string, otp?: string) {
  await pool.query(`INSERT INTO otp_sessions (session_id, phone_hash, otp_hash) VALUES ($1, $2, $3) ON CONFLICT (session_id) DO UPDATE SET phone_hash = EXCLUDED.phone_hash, otp_hash = EXCLUDED.otp_hash, attempts = 0, expires_at = now() + interval '5 minutes'`, [sessionId, otpPhoneHash(phone), otp ? otpHash('code:' + sessionId + ':' + otp) : null]);
  return sessionId;
}
async function rememberFixedOtp(phone: string, otp: string) {
  return rememberOtp(phone, randomUUID(), otp);
}

export async function sendOtp(phone: string) {
  const demo = await findActiveDemo(phone);
  if (demo) return rememberFixedOtp(phone, demo.otp);
  if (isPlayReviewPhone(phone)) return rememberFixedOtp(phone, process.env.PLAY_REVIEW_OTP!.trim());

  const channel = (process.env.OTP_CHANNEL || "sms").toLowerCase();
  if (channel === "voice") {
    const otp = String(randomInt(100000, 999999));
    const sessionId = randomUUID();
    const data = await factorGet(`VOICE/${phone}/${otp}`);
    if (data.Status !== "Success") {
      throw new HttpError(502, "Could not send the OTP. Try again.");
    }
    return rememberOtp(phone, sessionId, otp);
  }

  const data = await factorGet(`SMS/${phone}/AUTOGEN`);
  if (data.Status !== "Success" || !data.Details) {
    throw new HttpError(502, "Could not send the OTP. Try again.");
  }
  return rememberOtp(phone, data.Details);
}

export async function checkOtp(phone: string, otp: string, sessionId: string, connect: () => Promise<Pick<Db, "query" | "release">> = () => pool.connect()) {
  const db = await connect();
  let valid = false;
  try {
    await db.query('BEGIN');
    const result = await db.query<{ phone_hash: string; otp_hash: string | null; attempts: number; expired: boolean }>('SELECT phone_hash, otp_hash, attempts, expires_at <= now() AS expired FROM otp_sessions WHERE session_id = $1 FOR UPDATE', [sessionId]);
    const row = result.rows[0];
    if (row && !row.expired && row.attempts < 5 && row.phone_hash === otpPhoneHash(phone)) {
      if (row.otp_hash) valid = timingSafeEqual(Buffer.from(row.otp_hash, 'hex'), Buffer.from(otpHash('code:' + sessionId + ':' + otp), 'hex'));
      else valid = (await factorGet('SMS/VERIFY/' + encodeURIComponent(sessionId) + '/' + encodeURIComponent(otp))).Status === 'Success';
    }
    if (valid || row?.expired) await db.query('DELETE FROM otp_sessions WHERE session_id = $1', [sessionId]);
    else if (row) await db.query('UPDATE otp_sessions SET attempts = attempts + 1 WHERE session_id = $1', [sessionId]);
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
  if (!valid) throw new HttpError(400, 'Invalid or expired OTP', 'invalid_otp');
}
