import { pool } from "../db.js";
import { sendPush } from "./push.js";

type SearchHit = {
  id: string;
  user_id: string;
  city: string | null;
  locality: string | null;
  q: string | null;
  listing_type: string | null;
  bedrooms: number | null;
  min_price: string | null;
  max_price: string | null;
  added: number;
};

function rupees(value: string | null) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function matchSentence(search: SearchHit) {
  const count = Number(search.added);
  const bhk = search.bedrooms != null ? `${Number(search.bedrooms) >= 4 ? "4+" : search.bedrooms}BHK ` : "";
  const noun = search.listing_type === "rent"
    ? (count === 1 ? "rental" : "rentals")
    : search.listing_type === "lease"
      ? (count === 1 ? "lease" : "leases")
      : search.listing_type === "pg"
        ? (count === 1 ? "PG" : "PGs")
        : search.listing_type === "sale"
          ? (count === 1 ? "home for sale" : "homes for sale")
          : (count === 1 ? "property" : "properties");
  const place = (search.locality || search.q || search.city || "").trim();
  const where = place ? ` in ${place}` : "";
  const min = rupees(search.min_price);
  const max = rupees(search.max_price);
  const price = min && max ? ` from ${min} to ${max}` : max ? ` under ${max}` : min ? ` over ${min}` : "";
  return `${count} new ${bhk}${noun}${where}${price}.`;
}

/** Tell people who saved a matching search. Skips the owner and listings they were already told about. */
export async function alertSavedSearches(propertyId: string) {
  try {
    const found = await pool.query<SearchHit>(
      `WITH matched AS (
         INSERT INTO saved_search_hits (saved_search_id, property_id)
         SELECT s.id, p.id
         FROM saved_searches s
         JOIN properties p ON p.id = $1
         LEFT JOIN property_locations l ON l.property_id = p.id
         LEFT JOIN property_categories c ON c.id = p.category_id
         WHERE p.status = 'published'
           AND (p.expires_at IS NULL OR p.expires_at > now())
           AND s.user_id IS DISTINCT FROM p.owner_id
           AND COALESCE(p.published_at, p.created_at) >= s.created_at
           AND (s.listing_type IS NULL OR s.listing_type = p.listing_type)
           AND (s.bedrooms IS NULL OR p.bedrooms >= s.bedrooms)
           AND (s.min_price IS NULL OR p.price >= s.min_price)
           AND (s.max_price IS NULL OR p.price <= s.max_price)
           AND (s.min_area IS NULL OR p.area >= s.min_area)
           AND (s.max_area IS NULL OR p.area <= s.max_area)
           AND (
             s.category_slug IS NULL OR btrim(s.category_slug) = ''
             OR c.slug = s.category_slug OR c.id::text = s.category_slug
           )
           AND (
             s.city IS NULL OR btrim(s.city) = ''
             OR lower(coalesce(l.city, '')) = lower(btrim(s.city))
             OR lower(coalesce(l.city, '')) LIKE lower(btrim(s.city)) || '%'
           )
           AND (
             s.locality IS NULL OR btrim(s.locality) = ''
             OR lower(coalesce(l.locality, '')) LIKE '%' || lower(btrim(s.locality)) || '%'
           )
           AND (
             s.q IS NULL OR btrim(s.q) = ''
             OR p.title ILIKE '%' || regexp_replace(btrim(s.q), '[%_\\\\]', '', 'g') || '%'
             OR coalesce(l.city, '') ILIKE '%' || regexp_replace(btrim(s.q), '[%_\\\\]', '', 'g') || '%'
             OR coalesce(l.locality, '') ILIKE '%' || regexp_replace(btrim(s.q), '[%_\\\\]', '', 'g') || '%'
             OR coalesce(l.area, '') ILIKE '%' || regexp_replace(btrim(s.q), '[%_\\\\]', '', 'g') || '%'
           )
         ON CONFLICT DO NOTHING
         RETURNING saved_search_id
       )
       SELECT s.id, s.user_id, s.city, s.locality, s.q, s.listing_type,
              s.bedrooms, s.min_price::text, s.max_price::text, count(*)::int AS added
       FROM matched m
       JOIN saved_searches s ON s.id = m.saved_search_id
       GROUP BY s.id`,
      [propertyId]
    );
    for (const search of found.rows) {
      const sentence = matchSentence(search);
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, message, data)
         VALUES ($1, 'saved_search', 'New matches', $2, jsonb_build_object('saved_search_id', $3::text))`,
        [search.user_id, sentence, search.id]
      );
      void sendPush(search.user_id, {
        title: "New matches",
        body: sentence,
        data: { kind: "saved_search", searchId: search.id },
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Saved search alert failed");
  }
}
