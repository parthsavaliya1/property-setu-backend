import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { withDb } from "../db.js";
import { HttpError } from "../errors.js";
import { asyncRoute } from "../http.js";
import { BannerModel } from "../models/banner.model.js";
import { UserModel } from "../models/user.model.js";
import { buildPropertyKey, isConfigured, uploadBuffer } from "../services/bunnyStorage.js";
import { compressImageBuffer } from "../services/imageCompress.js";

const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

export function receiveBanner(req: Request, res: Response, next: NextFunction) {
  receive.single("file")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    res.status(400).json({ error: message });
  });
}

async function assertAdmin(userId: string) {
  const allowed = await withDb(userId, (db) => UserModel.isAdmin(db));
  if (!allowed) throw new HttpError(403, "Admin access required");
}

export const BannerController = {
  list: asyncRoute(async (_req, res) => {
    const rows = await withDb(null, (db) => BannerModel.listActive(db));
    res.json(rows);
  }),

  adminList: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const rows = await withDb(req.user!.id, (db) => BannerModel.listAll(db));
    res.json(rows);
  }),

  create: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    if (!isConfigured()) throw new HttpError(503, "File storage is not configured.");
    const file = req.file;
    if (!file) throw new HttpError(400, "Choose a banner image to upload.");
    const mime = file.mimetype || "";
    if (!mime.startsWith("image/")) throw new HttpError(400, "Upload a JPG, PNG, or WEBP image.");

    let buffer = file.buffer;
    let contentType = mime;
    const name = file.originalname || "banner.jpg";
    try {
      const compressed = await compressImageBuffer(buffer, name);
      buffer = compressed.buffer;
      contentType = compressed.contentType;
    } catch (err) {
      const message = err instanceof Error ? err.message : "compress failed";
      console.error(`[banner] image compress failed, uploading original: ${message}`);
    }

    const saved = await uploadBuffer(buffer, {
      remoteKey: buildPropertyKey("image", name, contentType),
      contentType,
    });
    const row = await withDb(req.user!.id, (db) => BannerModel.create(db, saved.url));
    if (!row) throw new HttpError(500, "Could not save the banner.");
    res.status(201).json(row);
  }),

  update: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({ is_active: z.boolean() }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => BannerModel.update(db, req.params.id, body.is_active));
    if (!row) throw new HttpError(404, "Banner not found");
    res.json(row);
  }),

  remove: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const row = await withDb(req.user!.id, (db) => BannerModel.remove(db, req.params.id));
    if (!row) throw new HttpError(404, "Banner not found");
    res.json(row);
  }),
};
