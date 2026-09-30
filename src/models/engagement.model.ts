import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { PropertyModel } from "./property.model.js";

export const EngagementModel = {
  async favorite(db: Db, propertyId: string) {
    const property = await PropertyModel.find(db, propertyId, false);
    if (!property) throw new HttpError(404, "Property not found");
    await db.query(
      `INSERT INTO property_favorites (user_id, property_id) VALUES (auth.uid(), $1) ON CONFLICT DO NOTHING`,
      [property.id]
    );
  },

  async unfavorite(db: Db, propertyId: string) {
    const property = await PropertyModel.find(db, propertyId, false);
    if (!property) return;
    await db.query(`DELETE FROM property_favorites WHERE user_id = auth.uid() AND property_id = $1`, [property.id]);
  },

  async favorites(db: Db) {
    const result = await db.query(
      `SELECT p.id, p.title, p.slug, p.price, p.listing_type, p.bedrooms, p.bathrooms, p.area, p.area_unit,
              p.status, l.city, l.locality,
              (SELECT image_url FROM property_images i WHERE i.property_id = p.id ORDER BY is_cover DESC, sort_order LIMIT 1) AS cover_image,
              f.created_at AS favorited_at
       FROM property_favorites f
       JOIN properties p ON p.id = f.property_id
       LEFT JOIN property_locations l ON l.property_id = p.id
       WHERE f.user_id = auth.uid()
       ORDER BY f.created_at DESC`
    );
    return result.rows;
  },

  async createInquiry(db: Db, propertyId: string, input: { name?: string; phone?: string; email?: string; message?: string; inquiry_type: string }) {
    const property = await PropertyModel.find(db, propertyId, false);
    if (!property) throw new HttpError(404, "Property not found");
    const result = await db.query(
      `INSERT INTO property_inquiries (property_id, buyer_id, name, phone, email, message, inquiry_type)
       VALUES ($1, auth.uid(), $2, $3, $4, $5, $6)
       RETURNING *`,
      [property.id, input.name ?? null, input.phone ?? null, input.email ?? null, input.message ?? null, input.inquiry_type]
    );
    return result.rows[0];
  },

  async inquiries(db: Db) {
    const result = await db.query(
      `SELECT i.*, p.title AS property_title, p.slug AS property_slug,
              (SELECT image_url FROM property_images img WHERE img.property_id = p.id ORDER BY is_cover DESC, sort_order LIMIT 1) AS cover_image
       FROM property_inquiries i
       JOIN properties p ON p.id = i.property_id
       ORDER BY i.created_at DESC`
    );
    return result.rows;
  },

  async updateInquiry(db: Db, id: string, status: string) {
    const result = await db.query(`UPDATE property_inquiries SET status = $2 WHERE id = $1 RETURNING *`, [id, status]);
    return result.rows[0] ?? null;
  },

  async createVisit(db: Db, propertyId: string, input: { scheduled_at: string; notes?: string }) {
    const property = await PropertyModel.find(db, propertyId, false);
    if (!property) throw new HttpError(404, "Property not found");
    const result = await db.query(
      `INSERT INTO property_visits (property_id, buyer_id, scheduled_at, notes)
       VALUES ($1, auth.uid(), $2, $3) RETURNING *`,
      [property.id, input.scheduled_at, input.notes ?? null]
    );
    return result.rows[0];
  },

  async visits(db: Db) {
    const result = await db.query(
      `SELECT v.*, p.title AS property_title, p.slug AS property_slug, l.city, l.locality,
              (SELECT image_url FROM property_images img WHERE img.property_id = p.id ORDER BY is_cover DESC, sort_order LIMIT 1) AS cover_image
       FROM property_visits v
       JOIN properties p ON p.id = v.property_id
       LEFT JOIN property_locations l ON l.property_id = p.id
       ORDER BY v.scheduled_at NULLS LAST, v.created_at DESC`
    );
    return result.rows;
  },

  async updateVisit(db: Db, id: string, input: { status: string; scheduled_at?: string; notes?: string }) {
    const result = await db.query(
      `UPDATE property_visits
       SET status = $2, scheduled_at = COALESCE($3, scheduled_at), notes = COALESCE($4, notes)
       WHERE id = $1 RETURNING *`,
      [id, input.status, input.scheduled_at ?? null, input.notes ?? null]
    );
    return result.rows[0] ?? null;
  },

  async createReport(db: Db, propertyId: string, input: { reason: string; description?: string }) {
    const property = await PropertyModel.find(db, propertyId, false);
    if (!property) throw new HttpError(404, "Property not found");
    const result = await db.query(
      `INSERT INTO property_reports (property_id, reported_by, reason, description)
       VALUES ($1, auth.uid(), $2, $3)
       RETURNING id, reason, status, created_at`,
      [property.id, input.reason, input.description ?? null]
    );
    return result.rows[0];
  },

  async savedSearches(db: Db) {
    const result = await db.query(`SELECT * FROM saved_searches WHERE user_id = auth.uid() ORDER BY created_at DESC`);
    return result.rows;
  },

  async createSavedSearch(db: Db, input: Record<string, string | number | undefined>) {
    const result = await db.query(
      `INSERT INTO saved_searches (
        user_id, name, city, locality, category_id, listing_type, min_price, max_price, min_area, max_area, bedrooms
      ) VALUES (auth.uid(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        input.name, input.city ?? null, input.locality ?? null, input.category_id ?? null, input.listing_type ?? null,
        input.min_price ?? null, input.max_price ?? null, input.min_area ?? null, input.max_area ?? null, input.bedrooms ?? null,
      ]
    );
    return result.rows[0];
  },

  async deleteSavedSearch(db: Db, id: string) {
    await db.query(`DELETE FROM saved_searches WHERE id = $1 AND user_id = auth.uid()`, [id]);
  },

  async notifications(db: Db) {
    const result = await db.query(
      `SELECT * FROM notifications WHERE user_id = auth.uid() ORDER BY created_at DESC LIMIT 50`
    );
    return result.rows;
  },

  async markNotificationRead(db: Db, id: string) {
    const result = await db.query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = auth.uid() RETURNING *`,
      [id]
    );
    return result.rows[0] ?? null;
  },
};
