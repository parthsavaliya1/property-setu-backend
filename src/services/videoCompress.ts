import { mediaSettings, type MediaSettings } from "./mediaSettings.js";
import { HttpError } from "../errors.js";
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

function extForMime(mime: string) {
  const value = mime.toLowerCase();
  if (value.includes("webm")) return ".webm";
  if (value.includes("quicktime") || value.includes("mov")) return ".mov";
  if (value.includes("3gpp")) return ".3gp";
  if (value.includes("matroska") || value.includes("mkv")) return ".mkv";
  return ".mp4";
}

export function durationFromOutput(output: string): number {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new HttpError(400, "Could not read video duration. Please choose another video.");
  const duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  if (!(duration > 0)) throw new HttpError(400, "The video is empty or invalid.");
  return duration;
}
export async function compressVideoBuffer(input: Buffer, mime = "video/mp4", settings?: MediaSettings) {
  const limits = settings || await mediaSettings();
  if (limits.maxVideos === 0) throw new HttpError(400, "Video uploads are currently disabled.");
  const crf = { high: 22, balanced: 28, compact: 32 }[limits.videoQuality];
  const audioBitrate = (process.env.MEDIA_VIDEO_AUDIO_BITRATE || "96k").trim() || "96k";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "property-vid-"));
  const inputPath = path.join(tmpDir, `in${extForMime(mime)}`);
  const outputPath = path.join(tmpDir, "out.mp4");
  try {
    fs.writeFileSync(inputPath, input);
    const probe = await execFileAsync(ffmpegBinary(), ["-hide_banner", "-i", inputPath, "-t", "0", "-f", "null", "-"], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    const duration = durationFromOutput(probe.stderr);
    if (duration > limits.maxVideoDurationSeconds + 0.05) throw new HttpError(400, `Each video must be ${limits.maxVideoDurationSeconds} seconds or shorter.`);
    await execFileAsync(ffmpegBinary(), [
      "-y", "-i", inputPath, "-map", "0:v:0", "-map", "0:a?",
      "-vf", `scale='if(gte(iw,ih),trunc(min(${limits.videoMaxEdge},iw)/2)*2,-2)':'if(gte(iw,ih),-2,trunc(min(${limits.videoMaxEdge},ih)/2)*2)'`,
      "-c:v", "libx264", "-preset", "medium", "-crf", String(crf),
      "-c:a", "aac", "-b:a", audioBitrate, "-movflags", "+faststart", outputPath,
    ], { timeout: 150000, maxBuffer: 2 * 1024 * 1024 });
    const output = fs.readFileSync(outputPath);
    if (!output.length) throw new Error("Empty compressed video");
    return { buffer: output, contentType: "video/mp4", durationSeconds: duration };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error("[video-compress] video validation or conversion failed");
    throw new HttpError(400, "Could not process this video. Please try a different video.");
  } finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
}
