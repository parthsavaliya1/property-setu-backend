import sharp from "sharp";
import { z } from "zod";
import { HttpError } from "../errors.js";

const categorySlugs = [
  "house",
  "apartment",
  "villa",
  "residential-plot",
  "agricultural-land",
  "shop",
  "office",
  "warehouse",
  "other-property",
] as const;

const amenitySlugs = [
  "parking",
  "garden",
  "lift",
  "security",
  "power-backup",
  "cctv",
  "swimming-pool",
  "club-house",
  "gym",
  "childrens-play-area",
] as const;

const featureKeys = ["Corner Plot", "Road Facing", "Main Road", "Gated Society"] as const;

const prompt = `You read Indian property posters, flyers, and listing cards. The image may mix English, Hindi, and Gujarati.
Return only the property that is for sale or rent. Use null when the image does not state a value. Never guess bathrooms, balconies, construction year, pincode, or price.

category_slug is one of: ${categorySlugs.join(", ")}.
A tenement, row house, bungalow, or independent house is house. A flat is apartment. A plot with no building is residential-plot.

listing_type is sale, rent, lease, or pg. A printed sale price with no rent words is sale.

title is short, like "2BHK Tenement", at most 160 characters.

description lists useful details from the poster. Leave out the broker name, agency name, and phone number.

address, city, locality, and pincode are only what is printed.
Write place names in common English spelling when you know them (રાજકોટ = Rajkot). Keep the street address readable in English.

bedrooms comes from text such as 2BHK, which means 2. bathrooms and balconies only if printed.

area_value is the number printed for the plot or built-up size. area_unit is sq_ft, sq_yd, vara, or sq_m.
In Gujarat, "var", "vara", or "વાર" is vara. Do not convert the number.
If the unit is unclear, leave area_value and area_unit null and put the raw text in area_note.

furnishing_status is furnished, semi_furnished, or unfurnished. "Semi furniture" is semi_furnished.
possession_status is "Ready to move" or "Under construction", or null.
price is digits only. 47,51,000 is 4751000. price_unit is total or per_sqft.
is_price_negotiable is true only if the poster says negotiable.

amenity_slugs may only contain: ${amenitySlugs.join(", ")}.
CCTV is cctv. Car parking is parking. A watchman or security is security.
features may only contain: ${featureKeys.join(", ")}.
A street width or frontage is "Road Facing". Use "Gated Society" only when a society is clearly named.

Ignore the agent name, the agency logo, and every phone number.`;

const responseSchema = {
  type: "OBJECT",
  properties: {
    category_slug: { type: "STRING", nullable: true },
    listing_type: { type: "STRING", nullable: true },
    title: { type: "STRING", nullable: true },
    description: { type: "STRING", nullable: true },
    address: { type: "STRING", nullable: true },
    city: { type: "STRING", nullable: true },
    locality: { type: "STRING", nullable: true },
    pincode: { type: "STRING", nullable: true },
    bedrooms: { type: "INTEGER", nullable: true },
    bathrooms: { type: "INTEGER", nullable: true },
    balconies: { type: "INTEGER", nullable: true },
    area_value: { type: "NUMBER", nullable: true },
    area_unit: { type: "STRING", nullable: true },
    area_note: { type: "STRING", nullable: true },
    furnishing_status: { type: "STRING", nullable: true },
    construction_year: { type: "INTEGER", nullable: true },
    possession_status: { type: "STRING", nullable: true },
    price: { type: "NUMBER", nullable: true },
    price_unit: { type: "STRING", nullable: true },
    is_price_negotiable: { type: "BOOLEAN", nullable: true },
    amenity_slugs: { type: "ARRAY", items: { type: "STRING" } },
    features: { type: "ARRAY", items: { type: "STRING" } },
  },
};

const emptyToNull = (value: unknown) => (value === "" || value === undefined ? null : value);

const optionalText = z.preprocess(emptyToNull, z.string().trim().min(1).nullable());

const optionalNumber = z.preprocess((value) => {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}, z.number().nullable());

const rawDraft = z.object({
  category_slug: optionalText,
  listing_type: optionalText,
  title: optionalText,
  description: optionalText,
  address: optionalText,
  city: optionalText,
  locality: optionalText,
  pincode: optionalText,
  bedrooms: optionalNumber,
  bathrooms: optionalNumber,
  balconies: optionalNumber,
  area_value: optionalNumber,
  area_unit: optionalText,
  area_note: optionalText,
  furnishing_status: optionalText,
  construction_year: optionalNumber,
  possession_status: optionalText,
  price: optionalNumber,
  price_unit: optionalText,
  is_price_negotiable: z.preprocess((value) => (value === "" || value === undefined ? null : value), z.boolean().nullable()).optional(),
  amenity_slugs: z.preprocess((value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [], z.array(z.string())),
  features: z.preprocess((value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [], z.array(z.string())),
});

export type ListingDraft = {
  category_slug: (typeof categorySlugs)[number] | null;
  listing_type: "sale" | "rent" | "lease" | "pg" | null;
  title: string | null;
  description: string | null;
  address: string | null;
  city: string | null;
  locality: string | null;
  pincode: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  balconies: number | null;
  area: number | null;
  furnishing_status: "unfurnished" | "semi_furnished" | "furnished" | null;
  construction_year: number | null;
  possession_status: "Ready to move" | "Under construction" | null;
  price: number | null;
  price_unit: "total" | "per_sqft" | null;
  is_price_negotiable: boolean | null;
  amenity_slugs: string[];
  features: string[];
};

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  if (!value) return null;
  const match = allowed.find((item) => item.toLowerCase() === value.toLowerCase());
  return match ?? null;
}

function whole(value: number | null, max: number) {
  if (value == null || value < 0 || value > max) return null;
  return Math.round(value);
}

function areaSqft(value: number | null, unit: string | null) {
  if (value == null || value <= 0) return null;
  const key = (unit || "").toLowerCase();
  if (key === "sq_ft" || key === "sqft") return Math.round(value);
  if (key === "sq_yd" || key === "vara" || key === "var") return Math.round(value * 9);
  if (key === "sq_m") return Math.round(value * 10.764);
  return null;
}

export function toListingDraft(input: unknown): ListingDraft {
  const raw = rawDraft.parse(input);
  const area = areaSqft(raw.area_value, raw.area_unit);
  const note = raw.area_note?.slice(0, 200) || null;
  let description = raw.description?.slice(0, 4000) || null;
  if (note && area != null && !description?.includes(note)) {
    const line = `${note} (${area} sq.ft).`;
    description = description ? `${description}\n${line}` : line;
  } else if (note && area == null) {
    description = description ? `${description}\n${note}` : note;
  }

  const pincode = raw.pincode && /^\d{6}$/.test(raw.pincode) ? raw.pincode : null;
  const year = whole(raw.construction_year, 2200);
  const price = raw.price != null && raw.price > 0 && raw.price < 100_000_000_000 ? Math.round(raw.price) : null;

  return {
    category_slug: oneOf(raw.category_slug, categorySlugs),
    listing_type: oneOf(raw.listing_type, ["sale", "rent", "lease", "pg"] as const),
    title: raw.title?.slice(0, 160) || null,
    description,
    address: raw.address?.slice(0, 300) || null,
    city: raw.city?.slice(0, 120) || null,
    locality: raw.locality?.slice(0, 120) || null,
    pincode,
    bedrooms: whole(raw.bedrooms, 30) || null,
    bathrooms: whole(raw.bathrooms, 30) || null,
    balconies: whole(raw.balconies, 20) || null,
    area,
    furnishing_status: oneOf(raw.furnishing_status, ["unfurnished", "semi_furnished", "furnished"] as const),
    construction_year: year != null && year >= 1800 ? year : null,
    possession_status: oneOf(raw.possession_status, ["Ready to move", "Under construction"] as const),
    price,
    price_unit: oneOf(raw.price_unit, ["total", "per_sqft"] as const),
    is_price_negotiable: raw.is_price_negotiable ?? null,
    amenity_slugs: [...new Set((raw.amenity_slugs || []).map((slug) => oneOf(slug, amenitySlugs)).filter((slug): slug is (typeof amenitySlugs)[number] => Boolean(slug)))],
    features: [...new Set((raw.features || []).map((feature) => oneOf(feature, featureKeys)).filter((feature): feature is (typeof featureKeys)[number] => Boolean(feature)))],
  };
}

function draftHasDetails(draft: ListingDraft) {
  return Boolean(draft.title || draft.price || draft.city || draft.address || draft.bedrooms);
}

async function toJpeg(buffer: Buffer) {
  try {
    return await sharp(buffer, { failOn: "none" })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    throw new HttpError(400, "Use a JPG or PNG photo.");
  }
}

function geminiText(body: unknown) {
  const payload = body as {
    error?: { message?: string };
    promptFeedback?: { blockReason?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  if (payload.error?.message) throw new HttpError(502, payload.error.message);
  if (payload.promptFeedback?.blockReason) throw new HttpError(422, "This photo could not be read.");
  const text = payload.candidates?.[0]?.content?.parts?.filter((part) => !part.thought).map((part) => part.text || "").join("").trim();
  if (!text) throw new HttpError(422, "No property details were found in this photo.");
  return text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
}

export async function extractListingFromImage(buffer: Buffer): Promise<ListingDraft> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new HttpError(503, "Photo reading is not configured. Add GEMINI_API_KEY on the server.");

  const jpeg = await toJpeg(buffer);
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: jpeg.toString("base64") } },
          ],
        }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Request failed";
    throw new HttpError(502, `Could not read the photo. ${reason}`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body as { error?: { message?: string } }).error?.message || "Could not read the photo.";
    throw new HttpError(response.status === 400 ? 422 : 502, message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(geminiText(body));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, "No property details were found in this photo.");
  }

  const draft = toListingDraft(parsed);
  if (!draftHasDetails(draft)) throw new HttpError(422, "No property details were found in this photo.");
  return draft;
}
