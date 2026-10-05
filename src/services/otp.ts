import { randomInt, randomUUID } from "node:crypto";
import { HttpError } from "../errors.js";

/** Play Console demo login. No SMS is sent. */
const PLAY_REVIEW_PHONE = "9909049699";
const PLAY_REVIEW_OTP = "111298";

const VOICE_OTP_TTL_MS = 5 * 60 * 1000;
const voiceOtpStore = new Map<string, { otp: string; phone: string; createdAt: number }>();

type FactorResponse = {
  Status?: string;
  Details?: string;
};

function apiKey() {
  const key = process.env.TWO_FACTOR_API_KEY?.trim();
  if (!key) throw new HttpError(503, "OTP is not configured");
  return key;
}

function cleanupExpiredVoiceSessions() {
  const now = Date.now();
  for (const [sessionId, data] of voiceOtpStore) {
    if (now - data.createdAt > VOICE_OTP_TTL_MS) voiceOtpStore.delete(sessionId);
  }
}

async function factorGet(path: string) {
  const response = await fetch(`https://2factor.in/API/V1/${apiKey()}/${path}`, {
    signal: AbortSignal.timeout(15000),
  });
  const data = (await response.json().catch(() => ({}))) as FactorResponse;
  return data;
}

export function isPlayReviewPhone(phone: string) {
  return phone === PLAY_REVIEW_PHONE;
}

export async function sendOtp(phone: string) {
  if (isPlayReviewPhone(phone)) {
    const sessionId = randomUUID();
    voiceOtpStore.set(sessionId, { otp: PLAY_REVIEW_OTP, phone, createdAt: Date.now() });
    return sessionId;
  }

  const channel = (process.env.OTP_CHANNEL || "sms").toLowerCase();
  if (channel === "voice") {
    cleanupExpiredVoiceSessions();
    const otp = String(randomInt(100000, 999999));
    const sessionId = randomUUID();
    const data = await factorGet(`VOICE/${phone}/${otp}`);
    if (data.Status !== "Success") {
      throw new HttpError(502, "Could not send the OTP. Try again.");
    }
    voiceOtpStore.set(sessionId, { otp, phone, createdAt: Date.now() });
    return sessionId;
  }

  const data = await factorGet(`SMS/${phone}/AUTOGEN`);
  if (data.Status !== "Success" || !data.Details) {
    throw new HttpError(502, "Could not send the OTP. Try again.");
  }
  return data.Details;
}

export async function checkOtp(phone: string, otp: string, sessionId: string) {
  if (isPlayReviewPhone(phone)) {
    if (otp !== PLAY_REVIEW_OTP) throw new HttpError(400, "Invalid or expired OTP", "invalid_otp");
    voiceOtpStore.delete(sessionId);
    return;
  }

  const voice = voiceOtpStore.get(sessionId);
  if (voice) {
    const expired = Date.now() - voice.createdAt > VOICE_OTP_TTL_MS;
    const matches = voice.phone === phone && voice.otp === otp && !expired;
    if (expired || matches) voiceOtpStore.delete(sessionId);
    if (!matches) throw new HttpError(400, "Invalid or expired OTP", "invalid_otp");
    return;
  }

  const data = await factorGet(`SMS/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(otp)}`);
  if (data.Status !== "Success") {
    throw new HttpError(400, "Invalid or expired OTP", "invalid_otp");
  }
}
