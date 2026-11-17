import { test } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db.js";
import { clearListingSettingsCache, listingSettings, saveListingSettings } from "../src/services/appSettings.js";
import { listingFeeRupees } from "../src/services/razorpay.js";
import { WalletController } from "../src/controllers/wallet.controller.js";
import type { Request, Response } from "express";

test("website offers change server charges while native app pricing stays unchanged", async t => {
  const values: Record<string, string> = { standard_price: "80", premium_price: "100", premium_offer_percent: "20", yearly_discount_percent: "20", website_offer_percent: "50" };
  t.mock.method(pool, "query", (async (sql: string, params?: string[]) => {
    if (sql.includes("INSERT INTO")) { values[params![0]] = params![1]; return { rows: [] }; }
    return { rows: Object.entries(values).map(([key, value]) => ({ key, value })) };
  }) as unknown as typeof pool.query);
  clearListingSettingsCache();
  try {
    assert.equal(await listingFeeRupees("standard", "month", "website"), 40);
    assert.equal(await listingFeeRupees("standard"), 80);
    assert.equal(await listingFeeRupees("premium", "month", "website"), 40);
    assert.equal(await listingFeeRupees("premium", "year", "website"), 384);
    await saveListingSettings({ standardPrice: 80, premiumPrice: 100, premiumOfferPercent: 20, yearlyDiscountPercent: 20, websiteOfferPercent: 40 });
    assert.equal((await listingSettings()).websiteOfferPercent, 40);
    assert.equal(await listingFeeRupees("standard", "month", "website"), 48);
    await saveListingSettings({ standardPrice: 80, premiumPrice: 100, premiumOfferPercent: 20, yearlyDiscountPercent: 20 });
    assert.equal((await listingSettings()).websiteOfferPercent, 40);
    await saveListingSettings({ standardPrice: 80, premiumPrice: 100, premiumOfferPercent: 20, yearlyDiscountPercent: 20, websiteOfferPercent: 0 });
    assert.equal(await listingFeeRupees("standard", "month", "website"), 80);
  } finally { clearListingSettingsCache(); }
});

test("a changed website quote is rejected before any wallet debit", async t => {
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("SELECT id FROM properties")) return { rows: [{ id: "00000000-0000-4000-8000-000000000001" }] };
      if (sql.includes("SELECT p.status")) return { rows: [{ status: "draft", expires_at: null, is_premium: false, listing_term: "month" }] };
      return { rows: [] };
    },
    release() {},
  };
  t.mock.method(pool, "connect", (async () => client) as unknown as typeof pool.connect);
  t.mock.method(pool, "query", (async () => ({ rows: [
    { key: "standard_price", value: "80" }, { key: "website_offer_percent", value: "40" },
  ] })) as unknown as typeof pool.query);
  clearListingSettingsCache();
  try {
    const error = await new Promise<{ status: number }>(resolve => {
      WalletController.spend({ user: { id: "owner" }, body: {
        property_id: "00000000-0000-4000-8000-000000000001", listing_badge: "standard", term: "month",
        pricing_channel: "website", expected_charge: 40,
      } } as unknown as Request, {} as Response, error => resolve(error as { status: number }));
    });
    assert.equal(error.status, 409);
    assert.ok(statements.includes("ROLLBACK"));
    assert.ok(!statements.some(sql => sql.includes("UPDATE wallets") || sql.includes("INSERT INTO wallet_transactions")));
  } finally { clearListingSettingsCache(); }
});
