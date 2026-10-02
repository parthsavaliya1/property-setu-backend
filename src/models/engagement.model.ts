import type { Db } from "../db.js";
import { HttpError } from "../errors.js";
import { PropertyModel } from "./property.model.js";

const messageSelect = `
  SELECT m.id, m.conversation_id, m.sender_id,
         CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body,
         CASE WHEN m.deleted_at IS NULL THEN m.attachment_url END AS attachment_url,
         CASE WHEN m.deleted_at IS NULL THEN m.attachment_name END AS attachment_name,
         CASE WHEN m.deleted_at IS NULL THEN m.attachment_kind END AS attachment_kind,
         (m.deleted_at IS NOT NULL) AS deleted,
         m.reply_to_id,
         CASE
           WHEN r.id IS NULL THEN NULL
           WHEN r.deleted_at IS NOT NULL THEN ''
           ELSE left(COALESCE(r.body, ''), 140)
         END AS reply_body,
         CASE WHEN r.id IS NOT NULL AND r.deleted_at IS NULL THEN r.attachment_kind END AS reply_kind,
         CASE WHEN r.id IS NOT NULL AND r.deleted_at IS NULL THEN r.attachment_name END AS reply_name,
         (r.deleted_at IS NOT NULL) AS reply_deleted,
         m.created_at,
         (m.sender_id = auth.uid()) AS mine
  FROM chat_messages m
  LEFT JOIN chat_messages r ON r.id = m.reply_to_id
`;

const reactionSelect = `
  SELECT message_id, emoji, count(*)::int AS count, bool_or(user_id = auth.uid()) AS mine
  FROM chat_message_reactions
  WHERE message_id = ANY($1::uuid[])
  GROUP BY message_id, emoji
  ORDER BY min(created_at)
`;

type ReactionRow = { message_id: string; emoji: string; count: number; mine: boolean };

async function withReactions(db: Db, rows: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  if (!rows.length) return rows;
  const result = await db.query<ReactionRow>(reactionSelect, [rows.map((row) => row.id)]);
  const grouped = new Map<string, Array<{ emoji: string; count: number; mine: boolean }>>();
  for (const reaction of result.rows) {
    const list = grouped.get(reaction.message_id) ?? [];
    list.push({ emoji: reaction.emoji, count: reaction.count, mine: reaction.mine });
    grouped.set(reaction.message_id, list);
  }
  return rows.map((row) => ({ ...row, reactions: grouped.get(String(row.id)) ?? [] }));
}

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

  async favorites(db: Db, limit: number, offset: number) {
    const result = await db.query(
      `SELECT p.id, p.title, p.slug, p.price, p.listing_type, p.bedrooms, p.bathrooms, p.area, p.area_unit,
              p.status, l.city, l.locality,
              (SELECT image_url FROM property_images i WHERE i.property_id = p.id ORDER BY is_cover DESC, sort_order LIMIT 1) AS cover_image,
              f.created_at AS favorited_at
       FROM property_favorites f
       JOIN properties p ON p.id = f.property_id
       LEFT JOIN property_locations l ON l.property_id = p.id
       WHERE f.user_id = auth.uid()
       ORDER BY f.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
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
      `SELECT * FROM notifications
       WHERE user_id = auth.uid()
         AND type IN ('new_inquiry', 'visit_request', 'visit_confirmed')
       ORDER BY created_at DESC LIMIT 80`
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

  async markNotificationsRead(db: Db) {
    await db.query(
      `UPDATE notifications SET is_read = true
       WHERE user_id = auth.uid() AND is_read = false
         AND type IN ('new_inquiry', 'visit_request', 'visit_confirmed')`
    );
  },

  async chats(db: Db) {
    const result = await db.query(
      `SELECT c.id, c.property_id, c.buyer_id, c.owner_id, c.created_at,
              p.title AS property_title,
              CASE WHEN c.buyer_id = auth.uid() THEN owner_profile.full_name ELSE buyer_profile.full_name END AS other_name,
              (SELECT CASE
                 WHEN m.deleted_at IS NOT NULL THEN 'This message was deleted'
                 WHEN char_length(btrim(COALESCE(m.body, ''))) > 0 THEN m.body
                 WHEN m.attachment_kind = 'image' THEN 'Photo'
                 WHEN m.attachment_kind = 'document' THEN 'Document'
                 ELSE ''
               END
               FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
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

  async chat(db: Db, conversationId: string) {
    const result = await db.query(
      `SELECT c.id, c.property_id, p.title AS property_title,
              CASE WHEN c.buyer_id = auth.uid() THEN owner_profile.full_name ELSE buyer_profile.full_name END AS other_name,
              CASE WHEN c.buyer_id = auth.uid() THEN owner_profile.avatar_url ELSE buyer_profile.avatar_url END AS other_avatar
       FROM conversations c
       JOIN properties p ON p.id = c.property_id
       LEFT JOIN user_profiles buyer_profile ON buyer_profile.id = c.buyer_id
       LEFT JOIN user_profiles owner_profile ON owner_profile.id = c.owner_id
       WHERE c.id = $1`,
      [conversationId]
    );
    return result.rows[0] ?? null;
  },

  async messages(db: Db, conversationId: string) {
    const thread = await db.query(`SELECT id FROM conversations WHERE id = $1`, [conversationId]);
    if (!thread.rows[0]) throw new HttpError(404, "Chat not found");
    const result = await db.query(`${messageSelect} WHERE m.conversation_id = $1 ORDER BY m.created_at ASC`, [conversationId]);
    return withReactions(db, result.rows);
  },

  async sendMessage(
    db: Db,
    conversationId: string,
    input: { body?: string; attachment_url?: string; attachment_name?: string; attachment_kind?: string; reply_to_id?: string }
  ) {
    const thread = await db.query(
      `SELECT id, property_id, buyer_id FROM conversations WHERE id = $1`,
      [conversationId]
    );
    const conversation = thread.rows[0];
    if (!conversation) throw new HttpError(404, "Chat not found");
    const text = (input.body ?? "").trim();
    if (!text && !input.attachment_url) throw new HttpError(400, "Write a message or attach a file.");
    if (input.reply_to_id) {
      const reply = await db.query(
        `SELECT id FROM chat_messages WHERE id = $1 AND conversation_id = $2`,
        [input.reply_to_id, conversationId]
      );
      if (!reply.rows[0]) throw new HttpError(400, "That message is not in this chat.");
    }
    const buyer = await db.query(`SELECT auth.uid() = $1 AS mine`, [conversation.buyer_id]);
    const prior = await db.query(
      `SELECT id FROM property_inquiries WHERE property_id = $1 AND buyer_id = auth.uid() LIMIT 1`,
      [conversation.property_id]
    );
    if (!prior.rows[0] && buyer.rows[0]?.mine) {
      await db.query(`SELECT set_config('app.skip_chat_notify', '1', true)`);
      const inquiryText = text || (input.attachment_kind === "document" ? "Shared a document" : "Shared a photo");
      await db.query(
        `INSERT INTO property_inquiries (property_id, buyer_id, message, inquiry_type)
         VALUES ($1, auth.uid(), $2, 'message')`,
        [conversation.property_id, inquiryText]
      );
    }
    const inserted = await db.query(
      `INSERT INTO chat_messages (conversation_id, sender_id, body, attachment_url, attachment_name, attachment_kind, reply_to_id)
       VALUES ($1, auth.uid(), $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        conversationId,
        text,
        input.attachment_url ?? null,
        input.attachment_name ?? null,
        input.attachment_kind ?? null,
        input.reply_to_id ?? null,
      ]
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new HttpError(404, "Chat not found");
    const result = await db.query(`${messageSelect} WHERE m.id = $1`, [id]);
    if (!result.rows[0]) throw new HttpError(404, "Chat not found");
    const [row] = await withReactions(db, result.rows);
    return row;
  },

  async deleteMessage(db: Db, conversationId: string, messageId: string) {
    const updated = await db.query(
      `UPDATE chat_messages
       SET deleted_at = now()
       WHERE id = $1 AND conversation_id = $2 AND sender_id = auth.uid() AND deleted_at IS NULL
       RETURNING id`,
      [messageId, conversationId]
    );
    if (!updated.rows[0]) return null;
    const result = await db.query(`${messageSelect} WHERE m.id = $1`, [messageId]);
    if (!result.rows[0]) return null;
    const [row] = await withReactions(db, result.rows);
    return row;
  },

  async toggleReaction(db: Db, conversationId: string, messageId: string, emoji: string) {
    const message = await db.query(
      `SELECT id, deleted_at FROM chat_messages WHERE id = $1 AND conversation_id = $2`,
      [messageId, conversationId]
    );
    if (!message.rows[0]) throw new HttpError(404, "Message not found");
    if (message.rows[0].deleted_at) throw new HttpError(400, "That message was deleted.");
    const current = await db.query(
      `SELECT emoji FROM chat_message_reactions WHERE message_id = $1 AND user_id = auth.uid()`,
      [messageId]
    );
    if (current.rows[0]?.emoji === emoji) {
      await db.query(`DELETE FROM chat_message_reactions WHERE message_id = $1 AND user_id = auth.uid()`, [messageId]);
    } else if (current.rows[0]) {
      await db.query(
        `UPDATE chat_message_reactions SET emoji = $2 WHERE message_id = $1 AND user_id = auth.uid()`,
        [messageId, emoji]
      );
    } else {
      await db.query(
        `INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES ($1, auth.uid(), $2)`,
        [messageId, emoji]
      );
    }
    const currentAfter = await db.query(
      `SELECT emoji FROM chat_message_reactions WHERE message_id = $1 AND user_id = auth.uid()`,
      [messageId]
    );
    const reactions = await db.query<ReactionRow>(reactionSelect, [[messageId]]);
    return {
      messageId,
      myEmoji: (currentAfter.rows[0]?.emoji as string | undefined) ?? null,
      reactions: reactions.rows.map((row) => ({ emoji: row.emoji, count: row.count, mine: row.mine })),
    };
  },
};
