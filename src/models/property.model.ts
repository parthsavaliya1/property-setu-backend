import type { Db } from "../db.js";
import { HttpError } from "../errors.js";

const publicColumns = `
  p.id, p.owner_id, p.agency_id, p.agent_id, p.category_id, p.title, p.slug,
  p.description, p.listing_type, p.property_type, p.price, p.price_unit,
  p.is_price_negotiable, p.area, p.area_unit, p.built_up_area, p.carpet_area,
  p.plot_area, p.bedrooms, p.bathrooms, p.balconies, p.floor_number, p.total_floors,
  p.parking_spaces, p.furnishing_status, p.construction_year, p.possession_status,
  p.facing, p.status, p.verification_status, p.is_featured, p.is_premium,
  p.published_at, p.expires_at, p.created_at, p.updated_at,
  COALESCE(
    CASE WHEN p.is_premium THEN 'Premium' WHEN p.is_featured THEN 'Featured' ELSE NULL END,
    (
      SELECT pf.feature_value FROM property_features pf
      WHERE pf.property_id = p.id
        AND pf.feature_key = 'listing_badge'
        AND pf.feature_value IN ('Premium', 'Featured')
      LIMIT 1
    )
  ) AS listing_label,
  c.name AS category_name, c.slug AS category_slug,
  parent.slug AS category_parent_slug,
  l.address, l.address_line_2, l.locality, l.area AS location_area, l.landmark,
  l.village, l.taluka, l.city, l.district, l.state, l.country, l.pincode,
  l.latitude, l.longitude,
  pr.full_name AS owner_name, pr.avatar_url AS owner_avatar,
  pr.city AS owner_city, pr.is_verified AS owner_verified
`;

function propertySelect(includePhone: boolean) {
  const phone = includePhone ? ", pr.phone AS owner_phone" : ", NULL::text AS owner_phone";
  const favorite = includePhone
    ? `EXISTS (
        SELECT 1 FROM property_favorites f
        WHERE f.property_id = p.id AND f.user_id = auth.uid()
      ) AS is_favorite`
    : "false AS is_favorite";
  return `
    SELECT ${publicColumns}${phone},
      (
        SELECT i.image_url FROM property_images i
        WHERE i.property_id = p.id
        ORDER BY i.is_cover DESC, i.sort_order, i.created_at
        LIMIT 1
      ) AS cover_image,
      ${favorite}
    FROM properties p
    JOIN property_categories c ON c.id = p.category_id
    LEFT JOIN property_categories parent ON parent.id = c.parent_id
    LEFT JOIN property_locations l ON l.property_id = p.id
    LEFT JOIN user_profiles pr ON pr.id = p.owner_id
  `;
}

export function likeTerm(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export type PropertyListQuery = {
  q?: string;
  listing_type?: string;
  category?: string;
  city?: string;
  min_price?: number;
  max_price?: number;
  bedrooms?: number;
  featured?: "true" | "false";
  mine?: "true" | "false";
  status?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  prefer_city?: string;
  city_first?: "true" | "false";
  limit: number;
  offset: number;
  ownerId?: string;
};

export type PropertyWrite = {
  category_id?: string;
  category_slug?: string;
  title?: string;
  description?: string;
  listing_type?: string;
  property_type?: string;
  price?: number;
  price_unit?: string;
  is_price_negotiable?: boolean;
  area?: number;
  area_unit?: string;
  built_up_area?: number;
  carpet_area?: number;
  plot_area?: number;
  bedrooms?: number;
  bathrooms?: number;
  balconies?: number;
  floor_number?: number;
  total_floors?: number;
  parking_spaces?: number;
  furnishing_status?: string;
  construction_year?: number;
  possession_status?: string;
  facing?: string;
  status?: string;
  agency_id?: string | null;
  agent_id?: string | null;
  location?: Record<string, string | number | undefined>;
  images?: Array<{
    image_url: string;
    thumbnail_url?: string;
    image_type?: string;
    is_cover?: boolean;
    sort_order?: number;
  }>;
  amenity_ids?: string[];
  features?: Array<{ feature_key: string; feature_value?: string }>;
  pricing?: {
    price: number;
    price_type?: string;
    maintenance_charge?: number;
    maintenance_period?: string;
    security_deposit?: number;
    negotiable?: boolean;
  };
  documents?: Array<{ document_type: string; document_url: string }>;
  listing_badge?: "standard" | "premium" | "featured";
};

export const PropertyModel = {
  async list(db: Db, query: PropertyListQuery, includePhone: boolean) {
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.split("?").join(`$${params.length}`));
    };

    if (query.mine === "true" && query.ownerId) add("p.owner_id = ?", query.ownerId);
    else where.push("p.status = 'published' AND (p.expires_at IS NULL OR p.expires_at > now())");
    if (query.status) add("p.status = ?", query.status);
    if (query.listing_type) add("p.listing_type = ?", query.listing_type);
    if (query.city) add("l.city ILIKE ?", likeTerm(query.city));
    if (query.min_price != null) add("p.price >= ?", query.min_price);
    if (query.max_price != null) add("p.price <= ?", query.max_price);
    if (query.bedrooms != null) add("p.bedrooms >= ?", query.bedrooms);
    if (query.featured === "true") where.push("p.is_featured = true");
    if (query.category) {
      params.push(query.category);
      const ref = `$${params.length}`;
      where.push(`(
        c.slug = ${ref} OR c.id::text = ${ref}
        OR parent.slug = ${ref} OR parent.id::text = ${ref}
      )`);
    }
    if (query.q) {
      add(
        `(p.title ILIKE ? ESCAPE '\\' OR p.description ILIKE ? ESCAPE '\\' OR l.city ILIKE ? ESCAPE '\\' OR l.locality ILIKE ? ESCAPE '\\' OR l.area ILIKE ? ESCAPE '\\')`,
        likeTerm(query.q)
      );
    }
    if (query.lat != null && query.lng != null && query.radius_km != null) {
      params.push(query.lat, query.lng, query.radius_km);
      const base = params.length;
      where.push(`p.id IN (
        SELECT property_id FROM properties_within_radius($${base - 2}, $${base - 1}, $${base})
      )`);
    }

    let cityRank = "";
    if (query.prefer_city?.trim()) {
      params.push(query.prefer_city.trim());
      const cityRef = `$${params.length}`;
      cityRank = `(
        lower(coalesce(l.city, '')) = lower(${cityRef})
        OR lower(coalesce(l.city, '')) LIKE lower(${cityRef}) || '%'
      ) DESC`;
    }

    const premiumRank = `(
         p.is_premium OR EXISTS (
           SELECT 1 FROM property_features badge
           WHERE badge.property_id = p.id
             AND badge.feature_key = 'listing_badge'
             AND badge.feature_value = 'Premium'
         )
       ) DESC`;
    const rank = (query.city_first === "true"
      ? [cityRank, premiumRank]
      : [premiumRank, cityRank]
    ).filter(Boolean).join(", ");
    params.push(query.limit, query.offset);
    const result = await db.query(
      `${propertySelect(includePhone)}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY ${rank}, p.published_at DESC NULLS LAST, p.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return result.rows;
  },

  async find(db: Db, idOrSlug: string, includePhone: boolean) {
    const result = await db.query(
      `${propertySelect(includePhone)} WHERE p.id::text = $1 OR p.slug = $1 LIMIT 1`,
      [idOrSlug]
    );
    return result.rows[0] ?? null;
  },

  async findDetail(db: Db, idOrSlug: string, includePhone: boolean) {
    const row = await this.find(db, idOrSlug, includePhone);
    if (!row) return null;
    const [images, amenities, features, prices] = await Promise.all([
      db.query(
        `SELECT id, image_url, thumbnail_url, image_type, sort_order, is_cover
         FROM property_images WHERE property_id = $1 ORDER BY is_cover DESC, sort_order, created_at`,
        [row.id]
      ),
      db.query(
        `SELECT a.id, a.name, a.slug, a.icon
         FROM property_amenities pa
         JOIN amenities a ON a.id = pa.amenity_id
         WHERE pa.property_id = $1
         ORDER BY a.name`,
        [row.id]
      ),
      db.query(
        `SELECT id, feature_key, feature_value FROM property_features WHERE property_id = $1 ORDER BY feature_key`,
        [row.id]
      ),
      db.query(
        `SELECT id, price, price_type, price_per_sqft, maintenance_charge, maintenance_period, security_deposit, negotiable
         FROM property_prices WHERE property_id = $1 ORDER BY created_at DESC`,
        [row.id]
      ),
    ]);
    return { ...row, images: images.rows, amenities: amenities.rows, features: features.rows, prices: prices.rows };
  },

  async create(db: Db, body: PropertyWrite) {
    const category = await db.query(
      `SELECT id, name FROM property_categories
       WHERE ($1::uuid IS NOT NULL AND id = $1::uuid) OR ($2::text IS NOT NULL AND slug = $2)
       LIMIT 1`,
      [body.category_id ?? null, body.category_slug ?? null]
    );
    if (!category.rows[0]) throw new HttpError(400, "Choose a property category");

    const inserted = await db.query(
      `INSERT INTO properties (
        owner_id, agency_id, agent_id, category_id, title, description, listing_type,
        property_type, price, price_unit, is_price_negotiable, area, area_unit,
        built_up_area, carpet_area, plot_area, bedrooms, bathrooms, balconies,
        floor_number, total_floors, parking_spaces, furnishing_status, construction_year,
        possession_status, facing, status
      ) VALUES (
        auth.uid(), $1, $2, $3, $4, $5, $6,
        $7, $8, $9, COALESCE($10, false), $11, COALESCE($12, 'sq_ft'),
        $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23,
        $24, $25, COALESCE($26, 'published')
      ) RETURNING id`,
      [
        body.agency_id ?? null,
        body.agent_id ?? null,
        category.rows[0].id,
        body.title,
        body.description ?? null,
        body.listing_type,
        body.property_type ?? category.rows[0].name,
        body.price ?? null,
        body.price_unit ?? null,
        body.is_price_negotiable ?? false,
        body.area ?? null,
        body.area_unit ?? null,
        body.built_up_area ?? null,
        body.carpet_area ?? null,
        body.plot_area ?? null,
        body.bedrooms ?? null,
        body.bathrooms ?? null,
        body.balconies ?? null,
        body.floor_number ?? null,
        body.total_floors ?? null,
        body.parking_spaces ?? null,
        body.furnishing_status ?? null,
        body.construction_year ?? null,
        body.possession_status ?? null,
        body.facing ?? null,
        body.status ?? null,
      ]
    );
    const id = inserted.rows[0].id as string;

    if (body.location) {
      const loc = body.location;
      await db.query(
        `INSERT INTO property_locations (
          property_id, address, address_line_2, locality, area, landmark, village, taluka,
          city, district, state, pincode, latitude, longitude
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          id, loc.address ?? null, loc.address_line_2 ?? null, loc.locality ?? null, loc.area ?? null,
          loc.landmark ?? null, loc.village ?? null, loc.taluka ?? null, loc.city ?? null,
          loc.district ?? null, loc.state ?? null, loc.pincode ?? null, loc.latitude ?? null, loc.longitude ?? null,
        ]
      );
    }

    for (const [index, image] of (body.images ?? []).entries()) {
      await db.query(
        `INSERT INTO property_images (property_id, image_url, thumbnail_url, image_type, sort_order, is_cover)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, image.image_url, image.thumbnail_url ?? null, image.image_type ?? "gallery", image.sort_order ?? index, image.is_cover ?? index === 0]
      );
    }
    for (const amenityId of body.amenity_ids ?? []) {
      await db.query(
        `INSERT INTO property_amenities (property_id, amenity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, amenityId]
      );
    }
    for (const feature of body.features ?? []) {
      await db.query(
        `INSERT INTO property_features (property_id, feature_key, feature_value)
         VALUES ($1, $2, $3)
         ON CONFLICT (property_id, feature_key) DO UPDATE SET feature_value = EXCLUDED.feature_value`,
        [id, feature.feature_key, feature.feature_value ?? null]
      );
    }
    if (body.listing_badge === "premium" || body.listing_badge === "featured") {
      await db.query(
        `INSERT INTO property_features (property_id, feature_key, feature_value)
         VALUES ($1, 'listing_badge', $2)
         ON CONFLICT (property_id, feature_key) DO UPDATE SET feature_value = EXCLUDED.feature_value`,
        [id, body.listing_badge === "premium" ? "Premium" : "Featured"]
      );
    }
    if (body.pricing) {
      await db.query(
        `INSERT INTO property_prices (
          property_id, price, price_type, maintenance_charge, maintenance_period, security_deposit, negotiable
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          id, body.pricing.price, body.pricing.price_type ?? null, body.pricing.maintenance_charge ?? null,
          body.pricing.maintenance_period ?? null, body.pricing.security_deposit ?? null, body.pricing.negotiable ?? false,
        ]
      );
    }
    for (const document of body.documents ?? []) {
      await db.query(
        `INSERT INTO property_documents (property_id, document_type, document_url, uploaded_by)
         VALUES ($1, $2, $3, auth.uid())`,
        [id, document.document_type, document.document_url]
      );
    }

    return this.find(db, id, true);
  },

  async update(db: Db, idOrSlug: string, body: PropertyWrite) {
    const existing = await this.find(db, idOrSlug, true);
    if (!existing) return null;
    await db.query(
      `UPDATE properties SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        listing_type = COALESCE($4, listing_type),
        price = COALESCE($5, price),
        is_price_negotiable = COALESCE($6, is_price_negotiable),
        area = COALESCE($7, area),
        bedrooms = COALESCE($8, bedrooms),
        bathrooms = COALESCE($9, bathrooms),
        balconies = COALESCE($10, balconies),
        furnishing_status = COALESCE($11, furnishing_status),
        facing = COALESCE($12, facing),
        status = COALESCE($13, status),
        possession_status = COALESCE($14, possession_status)
      WHERE id = $1`,
      [
        existing.id, body.title ?? null, body.description ?? null, body.listing_type ?? null, body.price ?? null,
        body.is_price_negotiable ?? null, body.area ?? null, body.bedrooms ?? null, body.bathrooms ?? null,
        body.balconies ?? null, body.furnishing_status ?? null, body.facing ?? null, body.status ?? null,
        body.possession_status ?? null,
      ]
    );
    if (body.location) {
      const loc = body.location;
      await db.query(
        `INSERT INTO property_locations (property_id, address, locality, city, pincode, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (property_id) DO UPDATE SET
           address = EXCLUDED.address,
           locality = EXCLUDED.locality,
           city = EXCLUDED.city,
           pincode = EXCLUDED.pincode,
           latitude = COALESCE(EXCLUDED.latitude, property_locations.latitude),
           longitude = COALESCE(EXCLUDED.longitude, property_locations.longitude)`,
        [existing.id, loc.address ?? null, loc.locality ?? null, loc.city ?? null, loc.pincode ?? null, loc.latitude ?? null, loc.longitude ?? null]
      );
    }
    if (body.images) {
      await db.query(`DELETE FROM property_images WHERE property_id = $1`, [existing.id]);
      for (const [index, image] of body.images.entries()) {
        await db.query(
          `INSERT INTO property_images (property_id, image_url, thumbnail_url, image_type, sort_order, is_cover)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [existing.id, image.image_url, image.thumbnail_url ?? null, image.image_type ?? "gallery", image.sort_order ?? index, image.is_cover ?? index === 0]
        );
      }
    }
    if (body.amenity_ids) {
      await db.query(`DELETE FROM property_amenities WHERE property_id = $1`, [existing.id]);
      for (const amenityId of body.amenity_ids) {
        await db.query(
          `INSERT INTO property_amenities (property_id, amenity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [existing.id, amenityId]
        );
      }
    }
    for (const document of body.documents ?? []) {
      await db.query(`DELETE FROM property_documents WHERE property_id = $1 AND document_type = $2`, [existing.id, document.document_type]);
      await db.query(
        `INSERT INTO property_documents (property_id, document_type, document_url, uploaded_by)
         VALUES ($1, $2, $3, auth.uid())`,
        [existing.id, document.document_type, document.document_url]
      );
    }
    if (body.listing_badge === "standard") {
      await db.query(
        `DELETE FROM property_features WHERE property_id = $1 AND feature_key = 'listing_badge'`,
        [existing.id]
      );
    } else if (body.listing_badge === "premium" || body.listing_badge === "featured") {
      await db.query(
        `INSERT INTO property_features (property_id, feature_key, feature_value)
         VALUES ($1, 'listing_badge', $2)
         ON CONFLICT (property_id, feature_key) DO UPDATE SET feature_value = EXCLUDED.feature_value`,
        [existing.id, body.listing_badge === "premium" ? "Premium" : "Featured"]
      );
    }
    return this.find(db, existing.id, true);
  },

  async remove(db: Db, idOrSlug: string, hard: boolean) {
    const existing = await this.find(db, idOrSlug, false);
    if (!existing) return null;
    if (hard) await db.query(`DELETE FROM properties WHERE id = $1`, [existing.id]);
    else await db.query(`UPDATE properties SET status = 'archived' WHERE id = $1`, [existing.id]);
    return { id: existing.id, archived: !hard };
  },

  async recordView(db: Db, idOrSlug: string, deviceType: string) {
    const property = await this.find(db, idOrSlug, false);
    if (!property) throw new HttpError(404, "Property not found");
    await db.query(
      `INSERT INTO property_views (property_id, user_id, device_type) VALUES ($1, auth.uid(), $2)`,
      [property.id, deviceType]
    );
  },

  async addImage(db: Db, propertyId: string, image: { image_url: string; thumbnail_url?: string; image_type?: string; is_cover?: boolean }) {
    const property = await this.find(db, propertyId, false);
    if (!property) return null;
    const result = await db.query(
      `INSERT INTO property_images (property_id, image_url, thumbnail_url, image_type, is_cover)
       VALUES ($1, $2, $3, $4, COALESCE($5, false))
       RETURNING *`,
      [property.id, image.image_url, image.thumbnail_url ?? null, image.image_type ?? "gallery", image.is_cover ?? false]
    );
    return result.rows[0];
  },

  async removeImage(db: Db, propertyId: string, imageId: string) {
    const result = await db.query(
      `DELETE FROM property_images WHERE id = $1 AND property_id = $2 RETURNING id`,
      [imageId, propertyId]
    );
    return result.rowCount ?? 0;
  },
};
