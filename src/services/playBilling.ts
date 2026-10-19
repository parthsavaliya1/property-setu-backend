import { createHash, createSign } from "node:crypto";
import { HttpError } from "../errors.js";
import { pool } from "../db.js";

export const creditPacks = [20, 30, 100, 204, 306, 500].map(credits => ({ product_id: `propertysetu_credits_${credits}`, credits }));
const packageName = "com.propertyhub.app";
let cachedToken: { value: string; expires: number } | null = null;
export const billingAccountId = (userId: string) => createHash("sha256").update(`propertysetu:${userId}`).digest("hex");
export const purchaseTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

async function accessToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;
  const email = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_PLAY_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new HttpError(503, "Google Play purchases are not configured yet. No payment was started.");
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }), signal: AbortSignal.timeout(15000) });
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!response.ok || !body.access_token) throw new HttpError(503, "Google Play verification is temporarily unavailable. Your purchase can be recovered later.");
  cachedToken = { value: body.access_token, expires: Date.now() + (body.expires_in || 3600) * 1000 };
  return body.access_token;
}

export function billingConfigured() {
  return Boolean(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL?.trim() && process.env.GOOGLE_PLAY_PRIVATE_KEY?.trim());
}

export type PlayPurchase = { purchaseState?: number; consumptionState?: number; quantity?: number; obfuscatedExternalAccountId?: string; orderId?: string };
export function validatePlayPurchase(purchase: PlayPurchase, userId: string) {
  if (purchase.purchaseState !== 0) throw new HttpError(409, "Purchase is pending or cancelled. Credits are added only after payment completes.");
  if ((purchase.quantity ?? 1) !== 1) throw new HttpError(400, "Unsupported purchase quantity");
  if (purchase.obfuscatedExternalAccountId !== billingAccountId(userId)) throw new HttpError(403, "This purchase belongs to a different PropertySetu account");
  if (purchase.consumptionState === 1) throw new HttpError(409, "This purchase has already been consumed");
}

async function googlePurchaseRequest(productId: string, token: string, consume = false) {
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}${consume ? ':consume' : ''}`;
  const response = await fetch(url, { method: consume ? "POST" : "GET", headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new HttpError(response.status === 404 || response.status === 400 ? 400 : 503, "Google Play could not verify this purchase. Please retry or contact support.");
  return consume ? {} : await response.json() as PlayPurchase;
}

export async function consumePlayPurchase(productId: string, token: string) {
  // A retry after a lost response may find the purchase already consumed.
  const purchase = await googlePurchaseRequest(productId, token) as PlayPurchase;
  if (purchase.consumptionState !== 1) await googlePurchaseRequest(productId, token, true);
  await pool.query(`UPDATE play_purchases SET consumed = true, purchase_token = NULL WHERE token_hash = $1`, [purchaseTokenHash(token)]);
}

export async function verifyAndCreditPlayPurchase(userId: string, productId: string, token: string) {
  const pack = creditPacks.find(item => item.product_id === productId);
  if (!pack) throw new HttpError(400, "Unknown credit pack");
  const hash = purchaseTokenHash(token);
  const existing = await pool.query<{ user_id: string | null; consumed: boolean; product_id: string; voided_at: Date | null }>(`SELECT user_id, consumed, product_id, voided_at FROM play_purchases WHERE token_hash = $1`, [hash]);
  if (existing.rows[0]) {
    const saved = existing.rows[0];
    if (saved.voided_at) throw new HttpError(409, "This purchase was refunded or cancelled");
    if (saved.user_id !== userId || saved.product_id !== productId) throw new HttpError(403, "Purchase already belongs to another account");
    if (!saved.consumed) await consumePlayPurchase(productId, token);
  } else {
    const purchase = await googlePurchaseRequest(productId, token) as PlayPurchase;
    validatePlayPurchase(purchase, userId);
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      // Serialize account deletion against credit delivery.
      const account = await db.query(`SELECT id FROM accounts WHERE id = $1 FOR UPDATE`, [userId]);
      if (!account.rowCount) throw new HttpError(404, "Account no longer exists");
      const inserted = await db.query(`INSERT INTO play_purchases (token_hash, user_id, product_id, credits, purchase_token) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING token_hash`, [hash, userId, productId, pack.credits, token]);
      if (inserted.rowCount) {
        await db.query(`INSERT INTO wallets (user_id, balance) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + EXCLUDED.balance, updated_at = now()`, [userId, pack.credits]);
        await db.query(`INSERT INTO wallet_transactions (user_id, amount, direction, reason, transaction_id) VALUES ($1, $2, 'credit', 'google_play', $3)`, [userId, pack.credits, `play:${hash}`]);
      } else {
        const saved = await db.query(`SELECT user_id, product_id FROM play_purchases WHERE token_hash = $1`, [hash]);
        if (saved.rows[0]?.user_id !== userId || saved.rows[0]?.product_id !== productId) throw new HttpError(403, "Purchase belongs to another account");
      }
      await db.query("COMMIT");
    } catch (err) { await db.query("ROLLBACK"); throw err; }
    finally { db.release(); }
    await consumePlayPurchase(productId, token);
  }
  const wallet = await pool.query(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]);
  return { ok: true, balance: Number(wallet.rows[0]?.balance || 0), credited: pack.credits };
}

export async function retryPlayConsumption(limit = 50, timeBudgetMs = 30000) {
  const rows = await pool.query<{ product_id: string; purchase_token: string }>(`SELECT product_id, purchase_token FROM play_purchases WHERE NOT consumed AND voided_at IS NULL AND purchase_token IS NOT NULL ORDER BY created_at LIMIT $1`, [limit]);
  let completed = 0;
  const deadline = Date.now() + timeBudgetMs;
  for (const row of rows.rows) {
    if (Date.now() >= deadline) break;
    try { await consumePlayPurchase(row.product_id, row.purchase_token); completed++; }
    catch { /* The durable token remains for the next retry. Never log purchase tokens. */ }
  }
  return completed;
}

async function reverseVoidedPurchase(token: string) {
  const hash = purchaseTokenHash(token);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const initial = await db.query(`SELECT user_id FROM play_purchases WHERE token_hash = $1`, [hash]);
    const userId = initial.rows[0]?.user_id as string | null | undefined;
    if (userId) await db.query(`SELECT id FROM accounts WHERE id = $1 FOR UPDATE`, [userId]);
    const receipt = await db.query(`SELECT user_id, credits, voided_at FROM play_purchases WHERE token_hash = $1 FOR UPDATE`, [hash]);
    const row = receipt.rows[0];
    if (row && !row.voided_at) {
      if (row.user_id) {
        const wallet = await db.query(`SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE`, [row.user_id]);
        const balance = Number(wallet.rows[0]?.balance || 0);
        const revoked = Math.min(balance, Number(row.credits));
        await db.query(`UPDATE wallets SET balance = GREATEST(balance - $2, 0), updated_at = now() WHERE user_id = $1`, [row.user_id, row.credits]);
        if (revoked > 0) await db.query(`INSERT INTO wallet_transactions (user_id, amount, direction, reason, transaction_id) VALUES ($1, $2, 'debit', 'google_play_refund', $3)`, [row.user_id, revoked, `play-refund:${hash}`]);
        // Spent refunded credits need human review before publishing more listings.
        if (balance < Number(row.credits)) await db.query(`UPDATE accounts SET suspended_at = COALESCE(suspended_at, now()) WHERE id = $1`, [row.user_id]);
      }
      await db.query(`UPDATE play_purchases SET voided_at = now(), purchase_token = NULL WHERE token_hash = $1`, [hash]);
    }
    await db.query("COMMIT");
  } catch (err) { await db.query("ROLLBACK"); throw err; }
  finally { db.release(); }
}

export async function reconcileVoidedPurchases(timeBudgetMs = 25000) {
  if (!billingConfigured()) return 0;
  let processed = 0;
  const deadline = Date.now() + timeBudgetMs;
  const saved = await pool.query(`SELECT next_page_token FROM play_billing_sync WHERE id = 1`);
  let page = saved.rows[0]?.next_page_token as string | undefined;
  do {
    const url = new URL(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/voidedpurchases`);
    url.searchParams.set("pageSelection.maxResults", "100");
    if (page) url.searchParams.set("pageSelection.token", page);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new HttpError(503, "Google Play refund reconciliation failed");
    const result = await response.json() as { voidedPurchases?: { purchaseToken?: string }[]; tokenPagination?: { nextPageToken?: string } };
    for (const purchase of result.voidedPurchases || []) {
      if (purchase.purchaseToken) { await reverseVoidedPurchase(purchase.purchaseToken); processed++; }
    }
    page = result.tokenPagination?.nextPageToken;
    await pool.query(`INSERT INTO play_billing_sync (id, next_page_token) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET next_page_token = EXCLUDED.next_page_token, updated_at = now()`, [page || null]);
  } while (page && Date.now() < deadline);
  return processed;
}
