import crypto from "node:crypto";
import { HttpError } from "../errors.js";

export type ListingBadge = "standard" | "premium";
export type ListingTerm = "month" | "year";

const monthlyFee = { standard: 20, premium: 30 } as const;

export function listingFeeRupees(badge: ListingBadge, term: ListingTerm = "month") {
  const monthly = monthlyFee[badge];
  if (term === "month") return monthly;
  return Math.round(monthly * 12 * 0.85);
}

export function paymentTypeFor(badge: ListingBadge) {
  return badge === "premium" ? "property_promotion" : "subscription";
}

export function badgeFromPaymentType(type: string | null): ListingBadge {
  if (type === "property_promotion") return "premium";
  return "standard";
}

export function razorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function credentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) {
    throw new HttpError(503, "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server.");
  }
  return { keyId, secret };
}

async function razorpayRequest(path: string, method = "GET", body?: unknown) {
  const { keyId, secret } = credentials();
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: { description?: string } };
  if (!response.ok) {
    throw new HttpError(502, payload.error?.description || "Razorpay could not start this payment");
  }
  return payload as Record<string, unknown>;
}

export async function createRazorpayOrder(amountRupees: number, receipt: string, notes: Record<string, string>) {
  const { keyId } = credentials();
  const order = await razorpayRequest("/orders", "POST", {
    amount: amountRupees * 100,
    currency: "INR",
    receipt: receipt.slice(0, 40),
    notes,
  });
  const orderId = String(order.id || "");
  if (!orderId) throw new HttpError(502, "Razorpay did not return an order");
  return { keyId, orderId, amount: amountRupees * 100, currency: "INR" };
}

export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
  const { secret } = credentials();
  const expected = crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export async function confirmedPayment(paymentId: string, orderId: string, amountPaise: number) {
  let payment = await razorpayRequest(`/payments/${paymentId}`);
  if (payment.order_id !== orderId) throw new HttpError(400, "Payment does not match this order");
  if (Number(payment.amount) !== amountPaise) throw new HttpError(400, "Payment amount does not match the listing fee");
  if (payment.status === "authorized") {
    payment = await razorpayRequest(`/payments/${paymentId}/capture`, "POST", {
      amount: amountPaise,
      currency: "INR",
    });
  }
  if (payment.status !== "captured") throw new HttpError(402, "Payment was not completed");
  return payment;
}
