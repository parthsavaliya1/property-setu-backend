import { z } from "zod";
import { pool, withDb } from "../db.js";
import { HttpError } from "../errors.js";
import { asyncRoute } from "../http.js";
import {
  badgeFromPaymentType,
  confirmedPayment,
  createRazorpayOrder,
  listingFeeRupees,
  paymentTypeFor,
  verifyPaymentSignature,
  type ListingBadge,
} from "../services/razorpay.js";

const badge = z.enum(["standard", "premium"]);

async function activateListing(userId: string, propertyId: string, plan: ListingBadge, orderId: string, paymentId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const property = await client.query(
      `UPDATE properties
       SET status = 'published',
           expires_at = now() + interval '1 month',
           published_at = COALESCE(published_at, now()),
           is_premium = $2,
           is_featured = false,
           verification_status = 'active'
       WHERE id = $1 AND owner_id = $3
       RETURNING id, expires_at, is_premium, verification_status`,
      [propertyId, plan === "premium", userId]
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
        `INSERT INTO property_features (property_id, feature_key, feature_value)
         VALUES ($1, 'listing_badge', 'Premium')`,
        [propertyId]
      );
    }
    await client.query(
      `INSERT INTO property_features (property_id, feature_key, feature_value)
       VALUES ($1, 'listing_term', 'month')`,
      [propertyId]
    );
    await client.query(
      `UPDATE payments
       SET status = 'paid', paid_at = now(), transaction_id = $2
       WHERE transaction_id = $1 AND user_id = $3`,
      [orderId, paymentId, userId]
    );
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* the original error is reported below */
    }
    throw error;
  } finally {
    client.release();
  }
}

export const PaymentController = {
  order: asyncRoute(async (req, res) => {
    const body = z.object({
      property_id: z.string().uuid(),
      listing_badge: badge,
    }).parse(req.body);
    const property = await withDb(req.user!.id, async (db) => {
      const result = await db.query(`SELECT id, title FROM properties WHERE id = $1`, [body.property_id]);
      return result.rows[0] as { id: string; title: string } | undefined;
    });
    if (!property) throw new HttpError(404, "Property not found");

    const amount = await listingFeeRupees(body.listing_badge, "month");
    const receipt = `p${body.property_id.replace(/-/g, "").slice(0, 12)}${Date.now().toString(36)}`;
    const order = await createRazorpayOrder(amount, receipt, {
      property_id: body.property_id,
      listing_badge: body.listing_badge,
    });
    await withDb(req.user!.id, (db) => db.query(
      `INSERT INTO payments (user_id, property_id, amount, currency, payment_type, provider, transaction_id, status)
       VALUES (auth.uid(), $1, $2, 'INR', $3, 'razorpay', $4, 'pending')`,
      [body.property_id, amount, paymentTypeFor(body.listing_badge), order.orderId]
    ));
    const description = body.listing_badge === "premium"
      ? "Premium listing for 1 month"
      : "Property listing for 1 month";
    res.json({
      key_id: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      description,
      property_title: property.title,
    });
  }),

  verify: asyncRoute(async (req, res) => {
    const body = z.object({
      property_id: z.string().uuid(),
      razorpay_order_id: z.string().min(1),
      razorpay_payment_id: z.string().min(1),
      razorpay_signature: z.string().min(1),
    }).parse(req.body);
    if (!verifyPaymentSignature(body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature)) {
      throw new HttpError(400, "Payment could not be verified");
    }
    const pending = await withDb(req.user!.id, async (db) => {
      const result = await db.query(
        `SELECT amount, payment_type, status
         FROM payments
         WHERE property_id = $2
           AND user_id = auth.uid()
           AND transaction_id IN ($1, $3)`,
        [body.razorpay_order_id, body.property_id, body.razorpay_payment_id]
      );
      return result.rows[0] as { amount: string; payment_type: string | null; status: string } | undefined;
    });
    if (!pending) throw new HttpError(404, "Payment order not found");
    if (pending.status === "paid") {
      res.json({ ok: true, already_paid: true });
      return;
    }
    const amountPaise = Math.round(Number(pending.amount) * 100);
    await confirmedPayment(body.razorpay_payment_id, body.razorpay_order_id, amountPaise);
    const plan = badgeFromPaymentType(pending.payment_type);
    const activated = await activateListing(req.user!.id, body.property_id, plan, body.razorpay_order_id, body.razorpay_payment_id);
    res.json({ ok: true, expires_at: activated.expires_at, status: "published" });
  }),
};
