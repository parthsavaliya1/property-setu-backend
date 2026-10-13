import { pool } from "../db.js";

export type ListingSettings = {
  standardPrice: number;
  premiumListPrice: number;
  premiumPrice: number;
  premiumOfferPercent: number;
  premiumSavings: number;
  yearlyDiscountPercent: number;
};

const fallback = {
  standardPrice: 20,
  premiumListPrice: 30,
  premiumOfferPercent: 0,
  yearlyDiscountPercent: 15,
};

function price(value: string | undefined, fallbackPrice: number) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return fallbackPrice;
  return Math.round(amount);
}

function percent(value: string | undefined, fallbackPercent: number) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 90) return fallbackPercent;
  return Math.round(amount);
}

function shape(raw: Record<string, string>): ListingSettings {
  const standardPrice = price(raw.standard_price, fallback.standardPrice);
  const premiumListPrice = price(raw.premium_price, fallback.premiumListPrice);
  const premiumOfferPercent = percent(raw.premium_offer_percent, fallback.premiumOfferPercent);
  const yearlyDiscountPercent = percent(raw.yearly_discount_percent, fallback.yearlyDiscountPercent);
  const premiumPrice = Math.round((premiumListPrice * (100 - premiumOfferPercent)) / 100);
  return {
    standardPrice,
    premiumListPrice,
    premiumPrice,
    premiumOfferPercent,
    premiumSavings: Math.max(0, premiumListPrice - premiumPrice),
    yearlyDiscountPercent,
  };
}

let cache: { at: number; settings: ListingSettings } | null = null;

export function clearListingSettingsCache() {
  cache = null;
}

export async function listingSettings(): Promise<ListingSettings> {
  const now = Date.now();
  if (cache && now - cache.at < 15_000) return cache.settings;
  try {
    const result = await pool.query<{ key: string; value: string }>(
      `SELECT key, value FROM public.app_settings
       WHERE key IN ('standard_price', 'premium_price', 'premium_offer_percent', 'yearly_discount_percent')`
    );
    const raw: Record<string, string> = {};
    for (const row of result.rows) raw[row.key] = row.value;
    const settings = shape(raw);
    cache = { at: now, settings };
    return settings;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") return shape({});
    if (cache) return cache.settings;
    return shape({});
  }
}

export async function saveListingSettings(input: {
  standardPrice: number;
  premiumPrice: number;
  premiumOfferPercent: number;
  yearlyDiscountPercent: number;
}) {
  const rows: Array<[string, string]> = [
    ["standard_price", String(input.standardPrice)],
    ["premium_price", String(input.premiumPrice)],
    ["premium_offer_percent", String(input.premiumOfferPercent)],
    ["yearly_discount_percent", String(input.yearlyDiscountPercent)],
  ];
  for (const [key, value] of rows) {
    await pool.query(
      `INSERT INTO public.app_settings (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value]
    );
  }
  clearListingSettingsCache();
  return listingSettings();
}
