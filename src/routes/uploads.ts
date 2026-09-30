import { Router } from "express";
import multer from "multer";
import { requireUser } from "../auth.js";
import { asyncRoute } from "../http.js";
import { buildPropertyKey, isConfigured, uploadBuffer } from "../services/bunnyStorage.js";
import { compressImageBuffer } from "../services/imageCompress.js";
import { compressVideoBuffer } from "../services/videoCompress.js";

const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024 },
});

function extForType(contentType: string) {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/gif") return ".gif";
  if (contentType === "video/mp4") return ".mp4";
  if (contentType === "application/pdf") return ".pdf";
  return ".jpg";
}

export const uploadRouter = Router();

uploadRouter.post(
  "/",
  requireUser,
  (req, res, next) => {
    receive.single("file")(req, res, (err) => {
      if (!err) {
        next();
        return;
      }
      const message = err instanceof Error ? err.message : "Upload failed";
      res.status(400).json({ error: message });
    });
  },
  asyncRoute(async (req, res) => {
    if (!isConfigured()) {
      res.status(503).json({ error: "File storage is not configured." });
      return;
    }
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Choose a file to upload." });
      return;
    }

    const kind = String(req.body?.kind || "image");
    let mime = file.mimetype || "application/octet-stream";
    if (!mime || mime === "application/octet-stream") {
      if (kind === "video") mime = "video/mp4";
      else if (kind === "document") mime = "application/pdf";
      else mime = "image/jpeg";
    }
    const image = mime.startsWith("image/");
    const video = kind === "video" || mime.startsWith("video/");
    const pdf = mime === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");

    if (!image && !video && !pdf) {
      res.status(400).json({ error: "Upload a photo, PDF, or video." });
      return;
    }

    let buffer = file.buffer;
    let contentType = mime;
    let name = file.originalname || "file";

    if (video) {
      const compressed = await compressVideoBuffer(buffer, mime);
      buffer = compressed.buffer;
      contentType = compressed.contentType;
    } else if (image) {
      try {
        const compressed = await compressImageBuffer(buffer, name);
        buffer = compressed.buffer;
        contentType = compressed.contentType;
      } catch (err) {
        const message = err instanceof Error ? err.message : "compress failed";
        console.error(`[image-compress] failed, uploading original: ${message}`);
      }
    } else {
      contentType = "application/pdf";
    }

    const ext = extForType(contentType);
    if (!name.toLowerCase().endsWith(ext)) name = `${name.replace(/\.[^.]+$/, "")}${ext}`;
    const folder = video || contentType.startsWith("video/") ? "video" : kind === "document" || pdf ? "document" : "image";
    const saved = await uploadBuffer(buffer, {
      remoteKey: buildPropertyKey(folder, name, contentType),
      contentType,
    });
    res.json({ file: saved });
  })
);
