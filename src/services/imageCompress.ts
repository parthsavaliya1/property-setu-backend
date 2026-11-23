import { defaultMediaSettings, type MediaSettings } from "./mediaSettings.js";
import sharp from "sharp";

function outputFormat(filename: string, meta: { format?: string; hasAlpha?: boolean }) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (ext === "gif" || meta.format === "gif") return "gif";
  if (ext === "png" || meta.format === "png" || meta.hasAlpha) return "png";
  if (ext === "webp" || meta.format === "webp") return "webp";
  return "jpeg";
}

async function encodeAtEdge(input: Buffer, maxEdge: number, format: string, jpegQuality: number) {
  const pipeline = sharp(input, { animated: format === "gif" }).rotate().resize(maxEdge, maxEdge, {
    fit: "inside",
    withoutEnlargement: true,
  });

  if (format === "gif") return { buffer: await pipeline.gif({ effort: 7 }).toBuffer(), contentType: "image/gif" };
  if (format === "jpeg") {
    const buffer = await pipeline.jpeg({ quality: jpegQuality, mozjpeg: true, force: true }).toBuffer();
    return { buffer, contentType: "image/jpeg" };
  }
  if (format === "webp") {
    const buffer = await pipeline.webp({ quality: jpegQuality, effort: 6, force: true }).toBuffer();
    return { buffer, contentType: "image/webp" };
  }

  const meta = await sharp(input).metadata();
  const buffer = await pipeline
    .png({
      compressionLevel: 9,
      effort: 10,
      palette: !meta.hasAlpha,
      quality: jpegQuality,
      force: true,
    })
    .toBuffer();
  return { buffer, contentType: "image/png" };
}

export async function compressImageBuffer(input: Buffer, filename = "", settings?: MediaSettings) {
  const limits = settings || defaultMediaSettings();
  const maxEdgeStart = limits.photoMaxEdge;
  const targetBytes = limits.photoTargetKb * 1024;
  const jpegQuality = limits.photoQuality;
  const meta = await sharp(input).metadata();
  const format = outputFormat(filename, meta);

  let maxEdge = maxEdgeStart;
  let last = await encodeAtEdge(input, maxEdge, format, jpegQuality);
  while (last.buffer.length > targetBytes && maxEdge > 128) {
    maxEdge = Math.round(maxEdge * 0.85);
    last = await encodeAtEdge(input, maxEdge, format, jpegQuality);
  }
  if (last.buffer.length > targetBytes && maxEdge <= 128) {
    last = await encodeAtEdge(input, 128, format, jpegQuality);
  }
  return last;
}
