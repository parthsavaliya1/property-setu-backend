import { createPublicKey, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";
import { HttpError } from "../errors.js";

type GoogleProfile = {
  email: string;
  name: string;
};

type CertCache = {
  expiresAt: number;
  keys: Map<string, KeyObject>;
};

let certCache: CertCache | null = null;

function configuredClients() {
  return {
    web: process.env.GOOGLE_CLIENT_ID?.trim() || "",
    secret: process.env.GOOGLE_CLIENT_SECRET?.trim() || "",
    ios: process.env.GOOGLE_IOS_CLIENT_ID?.trim() || "",
    android: process.env.GOOGLE_ANDROID_CLIENT_ID?.trim() || "",
  };
}

function friendlyGoogle(detail: string, redirectUri: string) {
  if (/redirect_uri/i.test(detail)) {
    return `Add this redirect URL in Google Cloud → Credentials → your OAuth client: ${redirectUri}`;
  }
  return detail;
}

async function googleKey(kid: string) {
  if (!certCache || certCache.expiresAt < Date.now() || !certCache.keys.has(kid)) {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
    if (!response.ok) throw new HttpError(502, "Could not verify Google sign-in.");
    const body = (await response.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys || []) {
      if (!jwk.kid) continue;
      keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" } as Parameters<typeof createPublicKey>[0]));
    }
    const maxAge = /max-age=(\d+)/.exec(response.headers.get("cache-control") || "");
    certCache = {
      keys,
      expiresAt: Date.now() + (maxAge ? Number(maxAge[1]) * 1000 : 60 * 60 * 1000),
    };
  }
  const key = certCache.keys.get(kid);
  if (!key) throw new HttpError(401, "Google sign-in could not be verified.");
  return key;
}

async function verifyIdToken(idToken: string, audiences: string[]): Promise<GoogleProfile> {
  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded?.header.kid;
  if (!kid || decoded.header.alg !== "RS256") {
    throw new HttpError(401, "Google sign-in could not be verified.");
  }
  const key = await googleKey(kid);
  let payload: jwt.JwtPayload;
  try {
    const verified = jwt.verify(idToken, key, {
      algorithms: ["RS256"],
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      clockTolerance: 30,
    });
    if (typeof verified === "string") throw new Error("Unexpected token payload");
    payload = verified;
    const audience = payload.aud;
    const audienceOk = typeof audience === "string"
      ? audiences.includes(audience)
      : Array.isArray(audience) && audience.some((item) => audiences.includes(item));
    if (!audienceOk) throw new HttpError(401, "Google sign-in could not be verified.");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "Google sign-in could not be verified.");
  }
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  if (!emailVerified) throw new HttpError(401, "Google did not confirm this email address.");
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email.includes("@")) throw new HttpError(400, "Google did not share an email address.");
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  return { email, name };
}

export async function verifyGoogleCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
}): Promise<GoogleProfile> {
  const clients = configuredClients();
  if (!clients.web || !clients.secret) {
    throw new HttpError(500, "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API.");
  }
  const allowed = [clients.web, clients.ios, clients.android].filter(Boolean);
  if (!allowed.includes(input.clientId)) {
    throw new HttpError(401, "This Google client ID is not allowed. Use the same client ID on the app and the API.");
  }

  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.codeVerifier,
  });
  if (input.clientId === clients.web) body.set("client_secret", clients.secret);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const token = (await response.json().catch(() => ({}))) as {
    id_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !token.id_token) {
    const detail = token.error_description || token.error || "Google did not return a login.";
    throw new HttpError(401, friendlyGoogle(detail, input.redirectUri));
  }
  return verifyIdToken(token.id_token, allowed);
}
