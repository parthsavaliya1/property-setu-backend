import { z } from "zod";
import { pool } from "../db.js";
import { HttpError } from "../errors.js";

export const propertyImageType = z.enum([
  "cover", "gallery", "exterior", "interior", "bedroom", "kitchen", "bathroom",
  "balcony", "garden", "parking", "floor_plan", "other", "video",
]);

export const mediaSettingsSchema = z.object({
  maxPhotos: z.number().int().min(2).max(50),
  maxVideos: z.number().int().min(0).max(10),
  maxVideoDurationSeconds: z.number().int().min(5).max(600),
  photoMaxEdge: z.number().int().min(320).max(3840),
  photoQuality: z.number().int().min(40).max(100),
  photoTargetKb: z.number().int().min(30).max(2048),
  videoMaxEdge: z.number().int().min(320).max(2160),
  videoQuality: z.enum(["high", "balanced", "compact"]),
});
export type MediaSettings = z.infer<typeof mediaSettingsSchema>;
function number(name: string, fallback: number) { const value = Number(process.env[name]); return value > 0 && Number.isFinite(value) ? Math.round(value) : fallback; }
export function defaultMediaSettings(): MediaSettings {
  return mediaSettingsSchema.parse({
    maxPhotos: 29, maxVideos: 1, maxVideoDurationSeconds: 60,
    photoMaxEdge: Math.min(3840, Math.max(320, number("MEDIA_IMAGE_MAX_EDGE", 720))),
    photoQuality: Math.min(100, Math.max(40, number("MEDIA_IMAGE_JPEG_QUALITY", 85))),
    photoTargetKb: Math.min(2048, Math.max(30, Math.round(number("MEDIA_IMAGE_TARGET_BYTES", 61440) / 1024))),
    videoMaxEdge: Math.min(2160, Math.max(320, number("MEDIA_VIDEO_MAX_EDGE", 480))),
    videoQuality: number("MEDIA_VIDEO_CRF", 32) >= 30 ? "compact" : number("MEDIA_VIDEO_CRF", 32) >= 25 ? "balanced" : "high",
  });
}
let cache: { at: number; value: MediaSettings } | undefined;
export function clearMediaSettingsCache() { cache = undefined; }
export async function mediaSettings(): Promise<MediaSettings> {
  if (cache && Date.now() - cache.at < 15000) return cache.value;
  try {
    const result = await pool.query<{ value: string }>("SELECT value FROM public.app_settings WHERE key = $1", ["media_settings"]);
    const parsed = mediaSettingsSchema.safeParse(JSON.parse(result.rows[0]?.value || "null"));
    const value = parsed.success ? parsed.data : defaultMediaSettings();
    cache = { at: Date.now(), value };
    return value;
  } catch { return cache?.value || defaultMediaSettings(); }
}
export async function saveMediaSettings(input: unknown): Promise<MediaSettings> {
  const value = mediaSettingsSchema.parse(input);
  await pool.query(`INSERT INTO public.app_settings (key, value, updated_at) VALUES ('media_settings', $1, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(value)]);
  cache = { at: Date.now(), value };
  return value;
}
export function validateMediaCounts(images: Array<{ image_type?: string }>, settings: MediaSettings) {
  const videos = images.filter(image => image.image_type === "video").length;
  const photos = images.length - videos;
  if (photos > settings.maxPhotos) throw new HttpError(400, `A property can have up to ${settings.maxPhotos} photos.`);
  if (videos > settings.maxVideos) throw new HttpError(400, `A property can have up to ${settings.maxVideos} videos.`);
}
