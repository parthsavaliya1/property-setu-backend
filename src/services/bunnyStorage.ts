import crypto from "node:crypto";
import https from "node:https";
import path from "node:path";

function getConfig() {
  const zone = process.env.BUNNY_STORAGE_ZONE?.trim();
  const accessKey = process.env.BUNNY_API_KEY?.trim() || process.env.BUNNY_STORAGE_ACCESS_KEY?.trim();
  const cdnBaseUrl = process.env.BUNNY_CDN_BASE_URL?.trim();
  const region = (process.env.BUNNY_STORAGE_REGION || "").trim().toLowerCase();
  const host = region ? `${region}.storage.bunnycdn.com` : "storage.bunnycdn.com";
  return { zone, accessKey, cdnBaseUrl, host };
}

export function isConfigured() {
  const { zone, accessKey, cdnBaseUrl } = getConfig();
  return Boolean(zone && accessKey && cdnBaseUrl);
}

function getUploadPrefix() {
  const raw = (process.env.BUNNY_UPLOAD_PREFIX || "property").trim().replace(/^\/+|\/+$/g, "");
  const safe = raw.replace(/[^a-zA-Z0-9_\-/]/g, "");
  return safe || "property";
}

export function storageKeyFromUrl(value?: string | null) {
  if (!value) return null;
  const { cdnBaseUrl } = getConfig();
  if (!cdnBaseUrl) return null;
  try {
    const base = new URL(cdnBaseUrl.replace(/\/+$/, "") + "/");
    const url = new URL(value);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
    const key = decodeURIComponent(url.pathname.slice(base.pathname.length));
    if (!key.startsWith(getUploadPrefix() + "/") || key.split("/").some(part => part === ".." || part === ".")) return null;
    return key;
  } catch { return null; }
}

export async function deleteStoredFile(remoteKey: string) {
  const { zone, accessKey, host } = getConfig();
  if (!zone || !accessKey) throw new Error("Bunny storage is not configured");
  if (!remoteKey.startsWith(getUploadPrefix() + "/") || remoteKey.split("/").some(part => part === ".." || part === ".")) throw new Error("Invalid storage key");
  const response = await fetch(`https://${host}/${encodeURIComponent(zone)}/${remoteKey.split("/").map(encodeURIComponent).join("/")}`, {
    method: "DELETE", headers: { AccessKey: accessKey }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Storage deletion failed (${response.status})`);
}

function safeExtFromName(name = "", mime = "") {
  const fromName = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (fromName && fromName.length <= 8) return fromName;
  const lookup: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/gif": ".gif",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
    "video/x-matroska": ".mkv",
    "video/3gpp": ".3gp",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain": ".txt",
  };
  return lookup[mime.toLowerCase()] || "";
}

export function buildPropertyKey(folder: "image" | "video" | "document", originalName: string, mime: string) {
  const ext = safeExtFromName(originalName, mime) || (folder === "video" ? ".mp4" : mime === "application/pdf" ? ".pdf" : ".jpg");
  return `${getUploadPrefix()}/${folder}/${crypto.randomUUID()}${ext}`;
}

export function uploadBuffer(buffer: Buffer, options: { remoteKey: string; contentType: string }) {
  return new Promise<{ url: string; key: string; size: number }>((resolve, reject) => {
    const { zone, accessKey, host, cdnBaseUrl } = getConfig();
    if (!zone || !accessKey || !cdnBaseUrl) {
      reject(new Error("Bunny storage is not configured on the server."));
      return;
    }
    const req = https.request(
      {
        method: "PUT",
        host,
        path: `/${zone}/${options.remoteKey}`,
        headers: {
          AccessKey: accessKey,
          "Content-Type": options.contentType || "application/octet-stream",
          "Content-Length": buffer.length,
          Accept: "application/json",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            const cleanBase = cdnBaseUrl.replace(/\/+$/, "");
            resolve({ url: `${cleanBase}/${options.remoteKey}`, key: options.remoteKey, size: buffer.length });
            return;
          }
          reject(new Error(`Bunny upload failed: ${res.statusCode} ${body}`));
        });
      }
    );
    req.on("error", reject);
    req.write(buffer);
    req.end();
  });
}
