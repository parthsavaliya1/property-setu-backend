import { pool } from "../db.js";

export const THEME_KEYS = [
  "terracotta",
  "fresh-green",
  "cream-mango",
  "classic-green",
  "olive-ivory",
  "teal-pistachio",
  "winter",
  "summer",
  "monsoon",
] as const;

export type ThemeKey = (typeof THEME_KEYS)[number];

/** Current PropertySetu look. Missing or unknown values stay on this palette. */
export const DEFAULT_THEME: ThemeKey = "terracotta";

const SETTING_KEY = "app_theme";

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && (THEME_KEYS as readonly string[]).includes(value);
}

export async function appTheme(): Promise<ThemeKey> {
  try {
    const result = await pool.query<{ value: string }>(
      `SELECT value FROM public.app_settings WHERE key = $1`,
      [SETTING_KEY]
    );
    const theme = result.rows[0]?.value;
    return isThemeKey(theme) ? theme : DEFAULT_THEME;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") return DEFAULT_THEME;
    return DEFAULT_THEME;
  }
}

export async function saveAppTheme(theme: ThemeKey): Promise<ThemeKey> {
  await pool.query(
    `INSERT INTO public.app_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTING_KEY, theme]
  );
  return theme;
}
