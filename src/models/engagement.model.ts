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

  async chats(db: Db) {
    const result = await db.query(
      `SELECT c.id, c.property_id, c.buyer_id, c.owner_id, c.created_at,
              p.title AS property_title,
              CASE WHEN c.buyer_id = auth.uid() THEN owner_profile.full_name ELSE buyer_profile.full_name END AS other_name,
              (SELECT m.body FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT m.created_at FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_at
       FROM conversations c
       JOIN properties p ON p.id = c.property_id
       LEFT JOIN user_profiles buyer_profile ON buyer_profile.id = c.buyer_id
       LEFT JOIN user_profiles owner_profile ON owner_profile.id = c.owner_id
       WHERE c.buyer_id = auth.uid() OR c.owner_id = auth.uid()
       ORDER BY last_at DESC NULLS LAST, c.created_at DESC`
    );
    return result.rows;
  },

  async openChat(db: Db, propertyId: string, buyerId?: string) {
    const property = await PropertyModel.find(db, propertyId, false);
    if (!property) throw new HttpError(404, "Property not found");
    if (buyerId) {
      const matched = await db.query(
        `SELECT * FROM conversations
         WHERE property_id = $1 AND buyer_id = $2
           AND (buyer_id = auth.uid() OR owner_id = auth.uid())`,
        [property.id, buyerId]
      );
      if (matched.rows[0]) return matched.rows[0];
      const createdForBuyer = await db.query(
        `INSERT INTO conversations (property_id, buyer_id, owner_id)
         SELECT $1, $2, p.owner_id
         FROM properties p
         WHERE p.id = $1 AND p.owner_id = auth.uid() AND $2 IS DISTINCT FROM auth.uid()
         ON CONFLICT (property_id, buyer_id) DO UPDATE SET property_id = EXCLUDED.property_id
         RETURNING *`,
        [property.id, buyerId]
      );
      if (createdForBuyer.rows[0]) return createdForBuyer.rows[0];
    }
    const existing = await db.query(
      `SELECT * FROM conversations WHERE property_id = $1 AND buyer_id = auth.uid()`,
      [property.id]
    );
    if (existing.rows[0]) return existing.rows[0];
    const created = await db.query(
      `INSERT INTO conversations (property_id, buyer_id, owner_id)
       SELECT $1, auth.uid(), p.owner_id
       FROM properties p
       WHERE p.id = $1 AND p.owner_id IS DISTINCT FROM auth.uid()
       ON CONFLICT (property_id, buyer_id) DO UPDATE SET property_id = EXCLUDED.property_id
       RETURNING *`,
      [property.id]
    );
    if (!created.rows[0]) throw new HttpError(400, "Open Messages to reply to buyers on your own listing.");
    return created.rows[0];
  },

  async messages(db: Db, conversationId: string) {
    const thread = await db.query(`SELECT id FROM conversations WHERE id = $1`, [conversationId]);
    if (!thread.rows[0]) throw new HttpError(404, "Chat not found");
    const result = await db.query(
      `SELECT id, conversation_id, sender_id, body, created_at,
              sender_id = auth.uid() AS mine
       FROM chat_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId]
    );
    return result.rows;
  },

  async sendMessage(db: Db, conversationId: string, body: string) {
    const thread = await db.query(
      `SELECT id, property_id, buyer_id FROM conversations WHERE id = $1`,
      [conversationId]
    );
    const conversation = thread.rows[0];
    if (!conversation) throw new HttpError(404, "Chat not found");
    const text = body.trim();
    const buyer = await db.query(`SELECT auth.uid() = $1 AS mine`, [conversation.buyer_id]);
    const prior = await db.query(
      `SELECT id FROM property_inquiries WHERE property_id = $1 AND buyer_id = auth.uid() LIMIT 1`,
      [conversation.property_id]
    );
    if (!prior.rows[0] && buyer.rows[0]?.mine) {
      await db.query(`SELECT set_config('app.skip_chat_notify', '1', true)`);
      await db.query(
        `INSERT INTO property_inquiries (property_id, buyer_id, message, inquiry_type)
         VALUES ($1, auth.uid(), $2, 'message')`,
        [conversation.property_id, text]
      );
    }
    const result = await db.query(
      `INSERT INTO chat_messages (conversation_id, sender_id, body)
       VALUES ($1, auth.uid(), $2)
       RETURNING id, conversation_id, sender_id, body, created_at, true AS mine`,
      [conversationId, text]
    );
    if (!result.rows[0]) throw new HttpError(404, "Chat not found");
    return result.rows[0];
  },
};
