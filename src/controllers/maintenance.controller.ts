import { timingSafeEqual } from "node:crypto";
import { asyncRoute } from "../http.js";
import { pool } from "../db.js";
import { processStorageDeletions } from "../services/accountDeletion.js";
import { retryPlayConsumption, reconcileVoidedPurchases } from "../services/playBilling.js";

export const maintenance = asyncRoute(async (req, res) => {
  const secret = process.env.CRON_SECRET?.trim();
  const actual = Buffer.from(req.header("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  const [consumed, deleted, refunds] = await Promise.all([retryPlayConsumption(100, 25000), processStorageDeletions(1000, 25000), reconcileVoidedPurchases(25000)]);
  await pool.query(`DELETE FROM auth_rate_limits WHERE resets_at < now()`);
  await pool.query(`DELETE FROM otp_sessions WHERE expires_at < now()`);
  res.setHeader("Cache-Control", "no-store");
  res.json({ consumed, deleted, refunds });
});
