import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import sharp from "sharp";
import { pool } from "../src/db.js";
import { mediaSettings, saveMediaSettings, defaultMediaSettings, clearMediaSettingsCache, mediaSettingsSchema, validateMediaCounts } from "../src/services/mediaSettings.js";
import { compressVideoBuffer, durationFromOutput } from "../src/services/videoCompress.js";
import { compressImageBuffer } from "../src/services/imageCompress.js";
const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const ffmpeg = require("@ffmpeg-installer/ffmpeg").path as string;

test("admin media settings persist together, reject invalid values, and enforce separate photo/video counts", async t => {
  let stored: string | undefined;
  t.mock.method(pool, "query", (async (sql: string, params: unknown[]) => {
    if (sql.includes("INSERT")) stored = String(params[0]);
    return { rows: stored ? [{ value: stored }] : [] };
  }) as unknown as typeof pool.query);
  clearMediaSettingsCache();
  const value = { ...defaultMediaSettings(), maxPhotos: 5, maxVideos: 2, maxVideoDurationSeconds: 60, photoMaxEdge: 1280, videoMaxEdge: 720, videoQuality: "high" as const };
  assert.deepEqual(await saveMediaSettings(value), value);
  clearMediaSettingsCache();
  assert.deepEqual(await mediaSettings(), value);
  for (const bad of [{ maxVideos: 11 }, { maxPhotos: 1 }, { maxVideoDurationSeconds: 0 }, { photoQuality: 101 }, { videoQuality: "unknown" }]) assert.equal(mediaSettingsSchema.safeParse({ ...value, ...bad }).success, false);
  const photos = Array.from({ length: 5 }, () => ({ image_type: "gallery" }));
  const videos = [{ image_type: "video" }, { image_type: "video" }];
  assert.doesNotThrow(() => validateMediaCounts([...photos, ...videos], value));
  assert.throws(() => validateMediaCounts([...photos, ...videos, { image_type: "video" }], value), /up to 2 videos/);
  assert.throws(() => validateMediaCounts([...photos, { image_type: "gallery" }], value), /up to 5 photos/);
  assert.throws(() => validateMediaCounts(videos, { ...value, maxVideos: 0 }), /up to 0 videos/);
  clearMediaSettingsCache();
});

test("real video upload rejects excessive duration and invalid files, and applies the configured resolution", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "property-media-test-"));
  const videoPath = path.join(dir, "input.mp4");
  try {
    await execute(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=c=blue:s=960x540:r=10", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    const input = await fs.readFile(videoPath);
    const limits = { ...defaultMediaSettings(), maxVideos: 2, maxVideoDurationSeconds: 60, videoMaxEdge: 320 };
    await assert.rejects(compressVideoBuffer(input, "video/mp4", { ...limits, maxVideoDurationSeconds: 1 }), /1 seconds or shorter/);
    await assert.rejects(compressVideoBuffer(Buffer.from("invalid"), "video/mp4", limits), /Could not process/);
    const compressed = await compressVideoBuffer(input, "video/mp4", limits);
    assert.ok(compressed.durationSeconds > 1.9 && compressed.durationSeconds < 2.1);
    assert.equal(compressed.contentType, "video/mp4");
    const outputPath = path.join(dir, "output.mp4");
    await fs.writeFile(outputPath, compressed.buffer);
    const output = await execute(ffmpeg, ["-hide_banner", "-i", outputPath, "-t", "0", "-f", "null", "-"]);
    assert.match(output.stderr, /320x180/);
    assert.equal(durationFromOutput("Duration: 00:01:00.00"), 60);
    assert.throws(() => durationFromOutput("Duration: N/A"), /Could not read/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("photo uploads apply the saved maximum resolution and quality settings", async () => {
  const input = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: "red" } }).jpeg().toBuffer();
  const output = await compressImageBuffer(input, "photo.jpg", { ...defaultMediaSettings(), photoMaxEdge: 640, photoQuality: 90, photoTargetKb: 2048 });
  const meta = await sharp(output.buffer).metadata();
  assert.equal(output.contentType, "image/jpeg");
  assert.equal(meta.width, 640);
  assert.equal(meta.height, 360);
});
