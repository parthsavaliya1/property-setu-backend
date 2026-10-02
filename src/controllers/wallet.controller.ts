import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, withDb } from "../db.js";
import { HttpError } from "../errors.js";
import { asyncRoute } from "../http.js";
import { confirmedPayment, createRazorpayOrder, upgradeCharge, type ListingBadge, type ListingTerm } from "../services/razorpay.js";
import { verifyPaymentSignature } from "../services/razorpay.js";

const badge = z.enum(["standard", "premium"]);
const term = z.enum(["month", "year"]);

async function ensureWallet(client: PoolClient, userId: string) {
  await client.query(
    `INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

export const WalletController = {
  show: asyncRoute(async (req, res) => {
    const wallet = await withDb(req.user!.id, async (db) => {
      const result = await db.query(`SELECT balance FROM wallets WHERE user_id = auth.uid()`);
      return result.rows[0] as { balance: string } | undefined;
    });
    res.json({ balance: Number(wallet?.balance ?? 0) });
  }),

  history: asyncRoute(async (req, res) => {
    const rows = await withDb(req.user!.id, async (db) => {
      const result = await db.query(
        `SELECT t.id, t.amount, t.direction, t.reason, t.property_id, t.created_at, p.title AS property_title
         FROM wallet_transactions t
         LEFT JOIN properties p ON p.id = t.property_id
         WHERE t.user_id = auth.uid()
         ORDER BY t.created_at DESC
         LIMIT 100`
      );
      return result.rows;
    });
    res.json(rows);
  }),

  order: asyncRoute(async (req, res) => {
    const body = z.object({ amount: z.coerce.number().int().min(1).max(100000) }).parse(req.body);
    const receipt = `w${req.user!.id.replace(/-/g, "").slice(0, 12)}${Date.now().toString(36)}`.slice(0, 40);
    const order = await createRazorpayOrder(body.amount, receipt, {
      user_id: req.user!.id,
      purpose: "wallet",
    });
    await withDb(req.user!.id, (db) => db.query(
      `INSERT INTO payments (user_id, amount, currency, payment_type, provider, transaction_id, status)
       VALUES (auth.uid(), $1, 'INR', 'other', 'razorpay', $2, 'pending')`,
      [body.amount, order.orderId]
    ));
    res.json({
      key_id: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      description: `Add ₹${body.amount} to wallet`,
    });
  }),

  verify: asyncRoute(async (req, res) => {
    const body = z.object({
      razorpay_order_id: z.string().min(1),
      razorpay_payment_id: z.string().min(1),
      razorpay_signature: z.string().min(1),
    }).parse(req.body);
    if (!verifyPaymentSignature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) {
      throw new HttpError(400, "Payment could not be verified");
    }
    const pending = await withDb(req.user!.id, async (db) => {
      const result = await db.query(
        `SELECT amount, status FROM payments
         WHERE user_id = auth.uid() AND transaction_id IN ($1, $2)`,
        [body.razorpay_order_id, body.razorpay_payment_id]
      );
      return result.rows[0] as { amount: string; status: string } | undefined;
    });
    if (!pending) throw new HttpError(404, "Payment order not found");
    const amount = Number(pending.amount);
    if (pending.status !== "paid") {
      await confirmedPayment(body.razorpay_payment_id, body.razorpay_order_id, Math.round(amount * 100));
    }
    const balance = await creditWallet(req.user!.id, amount, body.razorpay_payment_id, body.razorpay_order_id);
    res.json({ ok: true, balance });
  }),

  spend: asyncRoute(async (req, res) => {
    const body = z.object({
      property_id: z.string().uuid(),
      listing_badge: badge,
      term,
    }).parse(req.body);
    const owned = await withDb(req.user!.id, async (db) => {
      const result = await db.query(`SELECT id FROM properties WHERE id = $1`, [body.property_id]);
      return result.rows[0] as { id: string } | undefined;
    });
    if (!owned) throw new HttpError(404, "Property not found");
    const result = await spendForListing(req.user!.id, body.property_id, body.listing_badge, body.term);
    res.json(result);
  }),
};

async function creditWallet(userId: string, amount: number, paymentId: string, orderId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureWallet(client, userId);
    const inserted = await client.query(
      `INSERT INTO wallet_transactions (user_id, amount, direction, reason, transaction_id)
       VALUES ($1, $2, 'credit', 'wallet_topup', $3)
       ON CONFLICT (transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [userId, amount, paymentId]
    );
    if (inserted.rows[0]) {
      await client.query(`UPDATE wallets SET balance = balance + $2, updated_at = now() WHERE user_id = $1`, [userId, amount]);
    }
    await client.query(
      `UPDATE payments SET status = 'paid', paid_at = now(), transaction_id = $2
       WHERE transaction_id = $1 AND user_id = $3`,
      [orderId, paymentId, userId]
    );
    const wallet = await client.query(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]);
    await client.query("COMMIT");
    return Number(wallet.rows[0]?.balance ?? 0);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* report the original error */
    }
    throw error;
  } finally {
    client.release();
  }
}

async function spendForListing(userId: string, propertyId: string, plan: ListingBadge, listingTerm: ListingTerm) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT p.status, p.expires_at, p.is_premium,
         COALESCE(
           (SELECT f.feature_value FROM property_features f
            WHERE f.property_id = p.id AND f.feature_key = 'listing_term' LIMIT 1),
           CASE
             WHEN p.expires_at IS NOT NULL
               AND p.expires_at > COALESCE(p.published_at, p.created_at) + interval '300 days'
             THEN 'year' ELSE 'month'
           END
         ) AS listing_term
       FROM properties p
       WHERE p.id = $1 AND p.owner_id = $2`,
      [propertyId, userId]
    );
    const row = current.rows[0] as { status: string; expires_at: string | null; is_premium: boolean; listing_term: string } | undefined;
    if (!row) throw new HttpError(404, "Property not found");
    const live = row.status === "published" && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now());
    const savedBadge: ListingBadge = row.is_premium ? "premium" : "standard";
    const savedTerm: ListingTerm = row.listing_term === "year" ? "year" : "month";
    const fee = await upgradeCharge(plan, listingTerm, live ? savedBadge : null, live ? savedTerm : null);
    const expiryMode = !live
      ? (listingTerm === "year" ? "fresh_year" : "fresh_month")
      : (listingTerm === "year" && savedTerm === "month" ? "extend_year" : "keep");
    await ensureWallet(client, userId);
    const locked = await client.query(`SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE`, [userId]);
    const balance = Number(locked.rows[0]?.balance ?? 0);
    if (balance < fee) {
      throw new HttpError(402, `Wallet balance is ₹${balance}. Add ₹${fee - balance} to publish this listing.`);
    }
    if (fee > 0) {
      await client.query(`UPDATE wallets SET balance = balance - $2, updated_at = now() WHERE user_id = $1`, [userId, fee]);
      await client.query(
        `INSERT INTO wallet_transactions (user_id, amount, direction, reason, property_id)
         VALUES ($1, $2, 'debit', $3, $4)`,
        [userId, fee, listingTerm === "year" ? "listing_year" : "listing_month", propertyId]
      );
    }
    const property = await client.query(
      `UPDATE properties
       SET status = 'published',
           expires_at = CASE $2
             WHEN 'extend_year' THEN GREATEST(expires_at, now()) + interval '11 months'
             WHEN 'keep' THEN GREATEST(COALESCE(expires_at, now()), now())
             WHEN 'fresh_year' THEN now() + interval '1 year'
             ELSE now() + interval '1 month'
           END,
           published_at = COALESCE(published_at, now()),
           is_premium = $3,
           is_featured = false,
           verification_status = 'active'
       WHERE id = $1 AND owner_id = $4
       RETURNING id, expires_at, is_premium, verification_status`,
      [propertyId, expiryMode, plan === "premium", userId]
    );
    const saved = property.rows[0] as { id: string; expires_at: string; is_premium: boolean; verification_status: string } | undefined;
    if (!saved) throw new HttpError(404, "Property not found");
    if (plan === "premium" && saved.is_premium !== true) {
      throw new HttpError(500, "Premium could not be saved on this listing");
    }
    if (saved.verification_status !== "active") {
      throw new HttpError(500, "Listing could not be activated");
    }
    await client.query(
      `DELETE FROM property_features WHERE property_id = $1 AND feature_key IN ('listing_badge', 'listing_term')`,
      [propertyId]
    );
    if (plan === "premium") {
      await client.query(
        `INSERT INTO property_features (property_id, feature_key, feature_value) VALUES ($1, 'listing_badge', 'Premium')`,
        [propertyId]
      );
    }
    await client.query(
      `INSERT INTO property_features (property_id, feature_key, feature_value) VALUES ($1, 'listing_term', $2)`,
      [propertyId, listingTerm]
    );
    const wallet = await client.query(`SELECT balance FROM wallets WHERE user_id = $1`, [userId]);
    await client.query("COMMIT");
    return {
      ok: true,
      balance: Number(wallet.rows[0]?.balance ?? 0),
      charged: fee,
      expires_at: saved.expires_at,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* report the original error */
    }
    throw error;
  } finally {
    client.release();
  }
}
