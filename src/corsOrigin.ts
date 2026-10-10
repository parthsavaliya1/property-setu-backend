const LOCAL_ORIGINS = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://localhost:5173",
  "http://localhost:8081",
  "http://localhost:19006",
];

function configuredOrigins() {
  const fromEnv = process.env.CORS_ORIGIN?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return [...fromEnv, ...LOCAL_ORIGINS];
}

function privateLanHost(hostname: string) {
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  const match = /^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 16 && second <= 31;
}

export function isAllowedBrowserOrigin(origin: string | undefined) {
  if (!origin) return true;
  if (configuredOrigins().includes(origin)) return true;
  if (process.env.NODE_ENV === "production") return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && privateLanHost(url.hostname);
  } catch {
    return false;
  }
}
