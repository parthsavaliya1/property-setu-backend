import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function ffmpegBinary() {
  try {
    return require("@ffmpeg-installer/ffmpeg").path as string;
  } catch {
    return "ffmpeg";
  }
}

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function extForMime(mime: string) {
  const value = mime.toLowerCase();
  if (value.includes("webm")) return ".webm";
  if (value.includes("quicktime") || value.includes("mov")) return ".mov";
  if (value.includes("3gpp")) return ".3gp";
  if (value.includes("matroska") || value.includes("mkv")) return ".mkv";
  return ".mp4";
}

export async function compressVideoBuffer(input: Buffer, mime = "video/mp4") {
  const maxEdge = envInt("MEDIA_VIDEO_MAX_EDGE", 720);
  const targetBytes = envInt("MEDIA_VIDEO_TARGET_BYTES", 3 * 1024 * 1024);
  const crf = envInt("MEDIA_VIDEO_CRF", 28);
  const audioBitrate = (process.env.MEDIA_VIDEO_AUDIO_BITRATE || "96k").trim() || "96k";

  if (input.length > 0 && input.length <= targetBytes) {
    return { buffer: input, contentType: mime || "video/mp4" };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "property-vid-"));
  const inputPath = path.join(tmpDir, `in${extForMime(mime)}`);
  const outputPath = path.join(tmpDir, "out.mp4");
  try {
    fs.writeFileSync(inputPath, input);
    await execFileAsync(ffmpegBinary(), [
      "-y",
      "-i",
      inputPath,
      "-vf",
      `scale='min(${maxEdge},iw)':-2`,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      String(crf),
      "-c:a",
      "aac",
      "-b:a",
      audioBitrate,
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    const out = fs.readFileSync(outputPath);
    if (out.length > 0 && out.length < input.length) {
      return { buffer: out, contentType: "video/mp4" };
    }
    return { buffer: input, contentType: mime || "video/mp4" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "ffmpeg failed";
    console.error(`[video-compress] failed, uploading original: ${message}`);
    return { buffer: input, contentType: mime || "video/mp4" };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
