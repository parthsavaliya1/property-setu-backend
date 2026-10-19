import { z } from "zod";
import { withDb } from "../db.js";
import { asyncRoute } from "../http.js";
import { HttpError } from "../errors.js";

export const SafetyController = {
  blocks: asyncRoute(async (req, res) => {
    const rows = await withDb(req.user!.id, async db => (await db.query(
      `SELECT b.blocked_id, p.full_name FROM user_blocks b LEFT JOIN user_profiles p ON p.id = b.blocked_id WHERE b.blocker_id = auth.uid() ORDER BY b.created_at DESC`
    )).rows);
    res.json(rows);
  }),
  block: asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    if (id === req.user!.id) throw new HttpError(400, "You cannot block yourself");
    await withDb(req.user!.id, db => db.query(
      `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (auth.uid(), $1) ON CONFLICT DO NOTHING`, [id]
    ));
    res.status(204).end();
  }),
  unblock: asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    await withDb(req.user!.id, db => db.query(`DELETE FROM user_blocks WHERE blocker_id = auth.uid() AND blocked_id = $1`, [id]));
    res.status(204).end();
  }),
  reportUser: asyncRoute(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ reason: z.enum(["fraud", "inappropriate", "other"]), description: z.string().trim().max(2000).optional(), conversation_id: z.string().uuid().optional(), message_id: z.string().uuid().optional() }).parse(req.body);
    if (id === req.user!.id) throw new HttpError(400, "You cannot report yourself");
    const row = await withDb(req.user!.id, async db => {
      let snapshot: string | null = null;
      if (body.conversation_id) {
        const thread = await db.query(`SELECT id FROM conversations WHERE id = $1 AND ((buyer_id = auth.uid() AND owner_id = $2) OR (owner_id = auth.uid() AND buyer_id = $2))`, [body.conversation_id, id]);
        if (!thread.rowCount) throw new HttpError(404, "Chat not found");
      }
      if (body.message_id) {
        const message = await db.query(`SELECT id, body, attachment_url FROM chat_messages WHERE id = $1 AND conversation_id = $2 AND sender_id = $3`, [body.message_id, body.conversation_id ?? null, id]);
        if (!message.rowCount) throw new HttpError(404, "Message not found");
        snapshot = [message.rows[0].body, message.rows[0].attachment_url].filter(Boolean).join("\n").slice(0, 4000);
      }
      return (await db.query(`INSERT INTO property_reports (reported_by, reported_user_id, conversation_id, message_id, reason, description, reported_content) VALUES (auth.uid(), $1, $2, $3, $4, $5, $6) RETURNING id`, [id, body.conversation_id ?? null, body.message_id ?? null, body.reason, body.description ?? null, snapshot])).rows[0];
    });
    res.status(201).json(row);
  }),
};
