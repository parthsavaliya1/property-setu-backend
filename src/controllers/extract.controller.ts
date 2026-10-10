import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { asyncRoute } from "../http.js";
import { extractListingFromImage } from "../services/listingExtract.js";

const receive = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

export function receivePoster(req: Request, res: Response, next: NextFunction) {
  receive.single("file")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    res.status(400).json({ error: message });
  });
}

export const ExtractController = {
  fromImage: asyncRoute(async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Choose a photo of the property poster." });
      return;
    }
    const mime = file.mimetype || "";
    if (mime && !mime.startsWith("image/")) {
      res.status(400).json({ error: "Choose a photo of the property poster." });
      return;
    }
    const draft = await extractListingFromImage(file.buffer);
    res.json({ draft });
  }),
};
