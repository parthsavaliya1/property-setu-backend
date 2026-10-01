import { z } from "zod";
import { withDb } from "../db.js";
import { HttpError } from "../errors.js";
import { asyncRoute } from "../http.js";
import { EngagementModel } from "../models/engagement.model.js";
import { PropertyModel } from "../models/property.model.js";

export const EngagementController = {
  favorite: asyncRoute(async (req, res) => {
    await withDb(req.user!.id, (db) => EngagementModel.favorite(db, req.params.id));
    res.status(204).end();
  }),

  unfavorite: asyncRoute(async (req, res) => {
    await withDb(req.user!.id, (db) => EngagementModel.unfavorite(db, req.params.id));
    res.status(204).end();
  }),

  favorites: asyncRoute(async (req, res) => {
    const rows = await withDb(req.user!.id, (db) => EngagementModel.favorites(db));
    res.json(rows);
  }),

  createInquiry: asyncRoute(async (req, res) => {
    const body = z.object({
      name: z.string().max(120).optional(),
      phone: z.string().max(20).optional(),
      email: z.string().email().optional(),
      message: z.string().max(2000).optional(),
      inquiry_type: z.enum(["call", "whatsapp", "message", "visit", "price_request"]).default("message"),
    }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => EngagementModel.createInquiry(db, req.params.id, body));
    res.status(201).json(row);
  }),

  inquiries: asyncRoute(async (req, res) => {
    const rows = await withDb(req.user!.id, (db) => EngagementModel.inquiries(db));
    res.json(rows);
  }),

  updateInquiry: asyncRoute(async (req, res) => {
    const body = z.object({ status: z.enum(["new", "contacted", "interested", "closed", "spam"]) }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => EngagementModel.updateInquiry(db, req.params.id, body.status));
    if (!row) throw new HttpError(404, "Inquiry not found");
    res.json(row);
  }),

  createVisit: asyncRoute(async (req, res) => {
    const body = z.object({
      scheduled_at: z.string().datetime(),
      notes: z.string().max(1000).optional(),
    }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => EngagementModel.createVisit(db, req.params.id, body));
    res.status(201).json(row);
  }),

  visits: asyncRoute(async (req, res) => {
    const rows = await withDb(req.user!.id, (db) => EngagementModel.visits(db));
    res.json(rows);
  }),

  updateVisit: asyncRoute(async (req, res) => {
    const body = z.object({
      status: z.enum(["requested", "confirmed", "completed", "cancelled", "rescheduled"]),
      scheduled_at: z.string().datetime().optional(),
      notes: z.string().max(1000).optional(),
    }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => EngagementModel.updateVisit(db, req.params.id, body));
    if (!row) throw new HttpError(404, "Visit not found");
    res.json(row);
  }),

  createReport: asyncRoute(async (req, res) => {
    const body = z.object({
      reason: z.enum([
        "fake_property", "wrong_price", "wrong_location", "duplicate",
        "already_sold", "fraud", "inappropriate", "other",
      ]),
      description: z.string().max(2000).optional(),
    }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => EngagementModel.createReport(db, req.params.id, body));
    res.status(201).json(row);
  }),

  savedSearches: asyncRoute(async (req, res) => {
    const rows = await withDb(req.user!.id, (db) => EngagementModel.savedSearches(db));
    res.json(rows);
  }),

  createSavedSearch: asyncRoute(async (req, res) => {
    const body = z.object({
      name: z.string().min(1).max(80),
      city: z.string().max(120).optional(),
      locality: z.string().max(120).optional(),
      category_id: z.string().uuid().optional(),
      listing_type: z.enum(["sale", "rent", "lease", "pg"]).optional(),
      min_price: z.number().nonnegative().optional(),
      max_price: z.number().nonnegative().optional(),
      min_area: z.number().nonnegative().optional(),
      max_area: z.number().nonnegative().optional(),
      bedrooms: z.number().int().nonnegative().optional(),
    }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => EngagementModel.createSavedSearch(db, body));
    res.status(201).json(row);
  }),

  deleteSavedSearch: asyncRoute(async (req, res) => {
    await withDb(req.user!.id, (db) => EngagementModel.deleteSavedSearch(db, req.params.id));
    res.status(204).end();
  }),

  notifications: asyncRoute(async (req, res) => {
    const rows = await withDb(req.user!.id, (db) => EngagementModel.notifications(db));
    res.json(rows);
  }),

  readNotification: asyncRoute(async (req, res) => {
    const row = await withDb(req.user!.id, (db) => EngagementModel.markNotificationRead(db, req.params.id));
    if (!row) throw new HttpError(404, "Notification not found");
    res.json(row);
  }),

  chats: asyncRoute(async (req, res) => {
    const rows = await withDb(req.user!.id, (db) => EngagementModel.chats(db));
    res.json(rows);
  }),

  openChat: asyncRoute(async (req, res) => {
    const body = z.object({ buyer_id: z.string().uuid().optional() }).parse(req.body ?? {});
    const row = await withDb(req.user!.id, (db) => EngagementModel.openChat(db, req.params.id, body.buyer_id));
    res.status(201).json(row);
  }),

  messages: asyncRoute(async (req, res) => {
    const rows = await withDb(req.user!.id, (db) => EngagementModel.messages(db, req.params.id));
    res.json(rows);
  }),

  sendMessage: asyncRoute(async (req, res) => {
    const body = z.object({ body: z.string().trim().min(1).max(2000) }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => EngagementModel.sendMessage(db, req.params.id, body.body));
    res.status(201).json(row);
  }),

  addImage: asyncRoute(async (req, res) => {
    const body = z.object({
      image_url: z.string().url(),
      thumbnail_url: z.string().url().optional(),
      image_type: z.string().default("gallery"),
      is_cover: z.boolean().optional(),
    }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => PropertyModel.addImage(db, req.params.id, body));
    if (!row) throw new HttpError(404, "Property not found");
    res.status(201).json(row);
  }),

  removeImage: asyncRoute(async (req, res) => {
    const removed = await withDb(req.user!.id, (db) => PropertyModel.removeImage(db, req.params.id, req.params.imageId));
    if (!removed) throw new HttpError(404, "Image not found");
    res.status(204).end();
  }),
};
