import { createHmac } from "node:crypto";
import { pool } from "./db.js";
import { asyncRoute } from "./http.js";
import { HttpError } from "./errors.js";

function otpLimit(kind: "send" | "verify", limit: number) {
  return asyncRoute(async (req, _res, next) => {
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    if (!/^\d{10}$/.test(phone)) { next(); return; }
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new HttpError(503, "Sign-in is not configured");
    const hash = createHmac("sha256", secret).update(`${kind}:${phone}`).digest("hex");
    const result = await pool.query<{ attempts: number }>(`
      INSERT INTO auth_rate_limits (bucket_hash, attempts, resets_at) VALUES ($1, 1, now() + interval '15 minutes')
      ON CONFLICT (bucket_hash) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.resets_at <= now() THEN 1 ELSE auth_rate_limits.attempts + 1 END,
        resets_at = CASE WHEN auth_rate_limits.resets_at <= now() THEN now() + interval '15 minutes' ELSE auth_rate_limits.resets_at END
      RETURNING attempts`, [hash]);
    if (result.rows[0].attempts > limit) throw new HttpError(429, "Too many verification attempts. Please try again in 15 minutes.");
    next();
  });
}
export const otpSendLimit = otpLimit("send", 5);
export const otpVerifyLimit = otpLimit("verify", 10);
