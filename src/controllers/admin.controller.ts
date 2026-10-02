import { z } from "zod";
import { withDb } from "../db.js";
import { HttpError } from "../errors.js";
import { asyncRoute } from "../http.js";
import { AdminModel } from "../models/admin.model.js";
import { UserModel } from "../models/user.model.js";

async function assertAdmin(userId: string) {
  const allowed = await withDb(userId, (db) => UserModel.isAdmin(db));
  if (!allowed) throw new HttpError(403, "Admin access required");
}

export const AdminController = {
  stats: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const stats = await withDb(req.user!.id, (db) => AdminModel.stats(db));
    res.json(stats);
  }),

  properties: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const rows = await withDb(req.user!.id, (db) => AdminModel.properties(db));
    res.json(rows);
  }),

  updateProperty: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({
      status: z.enum(["draft", "pending_review", "published", "rejected", "sold", "rented", "expired", "archived"]).optional(),
      verification_status: z.enum(["pending", "submitted", "verified", "rejected", "active"]).optional(),
      is_featured: z.boolean().optional(),
      is_premium: z.boolean().optional(),
    }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => AdminModel.updateProperty(db, req.params.id, body));
    if (!row) throw new HttpError(404, "Property not found");
    res.json(row);
  }),

  reports: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const rows = await withDb(req.user!.id, (db) => AdminModel.reports(db));
    res.json(rows);
  }),

  updateReport: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({ status: z.enum(["pending", "reviewing", "resolved", "dismissed"]) }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => AdminModel.updateReport(db, req.params.id, body.status));
    if (!row) throw new HttpError(404, "Report not found");
    res.json(row);
  }),

  updateDocument: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({
      verification_status: z.enum(["pending", "submitted", "verified", "rejected"]),
    }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => AdminModel.updateDocument(db, req.params.id, body.verification_status));
    if (!row) throw new HttpError(404, "Document not found");
    res.json(row);
  }),
};
