// Same Firebase Remote Config fetch as the app (vadi-hisab/firebase.ts).
// custom_property_price and premium_property_price are monthly fees in rupees.

const PROJECT_ID = "vadi-hisab";
const APP_ID = "1:40446481049:web:2e346187ffa466328dde08";
const API_KEY = "AIzaSyAEqo0dC0fO2cMHyxeI3NOZdGsc4wEsZLE";

type ListingFees = { standard: number; premium: number };

const fallback: ListingFees = { standard: 20, premium: 30 };
let cache: { at: number; fees: ListingFees } | null = null;

function parseRcEntryValue(entry: unknown): string | null {
  if (entry == null) return null;
  if (typeof entry === "string") return entry;
  if (typeof entry === "object" && "value" in entry) {
    const value = (entry as { value?: unknown }).value;
    return typeof value === "string" ? value : null;
  }
  return null;
}

function priceOf(value: string | null | undefined, fallbackPrice: number) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return fallbackPrice;
  return Math.round(amount);
}

export async function listingFees(): Promise<ListingFees> {
  const now = Date.now();
  if (cache && now - cache.at < 60_000) return cache.fees;
  try {
    const url = `https://firebaseremoteconfig.googleapis.com/v1/projects/${PROJECT_ID}/namespaces/firebase:fetch?key=${API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: APP_ID,
        app_instance_id: "property-server",
        sdk_version: "9.0.0",
      }),
    });
    if (!response.ok) return cache?.fees ?? fallback;
    const json = await response.json() as { entries?: Record<string, unknown> };
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(json.entries ?? {})) {
      const parsed = parseRcEntryValue(value);
      if (parsed != null) entries[key] = parsed;
    }
    const fees = {
      standard: priceOf(entries.custom_property_price, fallback.standard),
      premium: priceOf(entries.premium_property_price, fallback.premium),
    };
    cache = { at: now, fees };
    return fees;
  } catch {
    return cache?.fees ?? fallback;
  }
}
