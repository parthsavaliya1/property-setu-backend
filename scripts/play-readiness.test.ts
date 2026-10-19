import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { billingAccountId, validatePlayPurchase } from "../src/services/playBilling.js";
import { storageKeyFromUrl } from "../src/services/bunnyStorage.js";
import { deletionHtml, deletionScript, legalPage } from "../src/legalPages.js";
import { pool } from "../src/db.js";
import { createHmac } from "node:crypto";
import { checkOtp, otpPhoneHash } from "../src/services/otp.js";
import type { Db } from "../src/db.js";
import { runInNewContext } from "node:vm";
import bcrypt from "bcryptjs";
import { AuthController } from "../src/controllers/auth.controller.js";
import type { Request, Response } from "express";

const buyer = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000002";
const stranger = "00000000-0000-4000-8000-000000000003";

test("mobile/password login remains available while email-only login is rejected", async t => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "isolated-admin-login-test-key";
  const password = "test-password-only";
  const hash = await bcrypt.hash(password, 4);
  t.mock.method(pool, "query", (async (_sql: string, parameters: string[]) => {
    assert.deepEqual(parameters, ["9000000001"]);
    return { rows: [{ id: buyer, email: null, phone: "9000000001", password_hash: hash, password_set: true }] };
  }) as unknown as typeof pool.query);
  function login(body: object) {
    return new Promise<{ status: number; body: { token?: string; error?: string } }>((resolve, reject) => {
      let status = 200;
      const response = { status(value: number) { status = value; return response; }, json(value: { token?: string; error?: string }) { resolve({ status, body: value }); return response; } };
      AuthController.login({ body } as Request, response as unknown as Response, reject);
    });
  }
  try {
    const result = await login({ phone: "9000000001", password });
    assert.equal(result.status, 200);
    assert.ok(result.body.token);
    assert.equal((await login({ phone: "9000000001", password: "incorrect-password" })).status, 401);
    await assert.rejects(login({ email: "unused@example.com", password }));
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
  }
});

test("Play purchases reject pending, cancelled, consumed, cross-account and multiple-quantity receipts", () => {
  const valid = { purchaseState: 0, consumptionState: 0, quantity: 1, obfuscatedExternalAccountId: billingAccountId(buyer) };
  assert.doesNotThrow(() => validatePlayPurchase(valid, buyer));
  for (const purchase of [{ ...valid, purchaseState: 1 }, { ...valid, purchaseState: 2 }, { ...valid, consumptionState: 1 }, { ...valid, quantity: 2 }, { ...valid, obfuscatedExternalAccountId: billingAccountId(owner) }, { ...valid, obfuscatedExternalAccountId: undefined }]) {
    assert.throws(() => validatePlayPurchase(purchase, buyer));
  }
});

test("storage cleanup accepts only configured storage paths", () => {
  const previous = { base: process.env.BUNNY_CDN_BASE_URL, prefix: process.env.BUNNY_UPLOAD_PREFIX };
  process.env.BUNNY_CDN_BASE_URL = "https://media.example.com/assets";
  process.env.BUNNY_UPLOAD_PREFIX = "property";
  try {
    assert.equal(storageKeyFromUrl("https://media.example.com/assets/property/image/photo.jpg"), "property/image/photo.jpg");
    for (const url of ["https://evil.example/assets/property/image/photo.jpg", "https://media.example.com/other/property/image/photo.jpg", "https://media.example.com/assets/property/%2e%2e/secret", "not-a-url"]) assert.equal(storageKeyFromUrl(url), null);
  } finally {
    if (previous.base === undefined) delete process.env.BUNNY_CDN_BASE_URL; else process.env.BUNNY_CDN_BASE_URL = previous.base;
    if (previous.prefix === undefined) delete process.env.BUNNY_UPLOAD_PREFIX; else process.env.BUNNY_UPLOAD_PREFIX = previous.prefix;
  }
});

test("browser deletion requires verification and consent, and survives a failed deletion request", async () => {
  type Element = { value: string; checked: boolean; disabled: boolean; hidden: boolean; textContent: string; onclick?: () => Promise<void>; onchange?: () => void };
  const elements: Record<string, Element> = {};
  for (const id of ["phone", "otp", "confirm", "send", "verify", "remove", "phone-step", "code-step", "delete-step", "notice"]) elements[id] = { value: "", checked: false, disabled: id === "remove", hidden: id === "code-step" || id === "delete-step", textContent: "" };
  let deletes = 0;
  let verified = false;
  let failNextDelete = true;
  const fetch = async (url: string, options: { method: string; body?: string; headers: Record<string, string> }) => {
    const body = options.body ? JSON.parse(options.body) : null;
    if (url === "/api/auth/send-otp") { assert.equal(body.create, false); return { ok: true, status: 200, json: async () => ({ sessionId: "test-session" }) }; }
    if (url === "/api/auth/verify-otp") { assert.equal(body.sessionId, "test-session"); verified = true; return { ok: true, status: 200, json: async () => ({ token: "test-only-token" }) }; }
    assert.equal(url, "/api/me"); assert.equal(options.method, "DELETE");
    assert.equal(verified, true); assert.equal(elements.confirm.checked, true); assert.equal(options.headers.Authorization, "Bearer test-only-token"); deletes++;
    if (failNextDelete) { failNextDelete = false; return { ok: false, status: 503, json: async () => ({ error: "Temporarily unavailable" }) }; }
    return { ok: true, status: 204, json: async () => ({}) };
  };
  runInNewContext(deletionScript, { document: { getElementById: (id: string) => elements[id], querySelectorAll: () => [elements.send, elements.verify, elements.remove] }, fetch });
  await elements.remove.onclick!(); assert.equal(deletes, 0);
  elements.phone.value = "9000000001";
  await elements.send.onclick!();
  elements.otp.value = "123456";
  await elements.verify.onclick!(); assert.equal(elements["delete-step"].hidden, false);
  await elements.remove.onclick!(); assert.equal(deletes, 0);
  elements.confirm.checked = true; elements.confirm.onchange!();
  await elements.remove.onclick!(); assert.equal(deletes, 1);
  assert.match(elements.notice.textContent, /Temporarily unavailable/);
  assert.equal(elements["delete-step"].hidden, false);
  await elements.remove.onclick!(); assert.equal(deletes, 2);
  assert.match(elements.notice.textContent, /account has been deleted/);
  assert.equal(elements["delete-step"].hidden, true);
  await elements.remove.onclick!(); assert.equal(deletes, 2);
  assert.match(deletionHtml(), /id="confirm" type="checkbox"/);
  assert.match(legalPage('<script>alert("test")</script>', ""), /&lt;script&gt;/);
});

test("durable OTP verification binds the phone, rejects replay, expires and limits guesses", async () => {
  const db = new PGlite();
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "isolated-otp-test-key";
  const client = { query: db.query.bind(db), release() {} } as unknown as Pick<Db, "query" | "release">;
  const connect = async () => client;
  const phone = "9000000001";
  const code = "123456";
  try {
    await db.exec(await fs.readFile(new URL("../migrations/052_durable_otp.sql", import.meta.url), "utf8"));
    const save = async (id: string) => {
      const hash = createHmac("sha256", process.env.JWT_SECRET!).update(`code:${id}:${code}`).digest("hex");
      await db.query(`INSERT INTO otp_sessions (session_id, phone_hash, otp_hash) VALUES ($1, $2, $3)`, [id, otpPhoneHash(phone), hash]);
    };
    await save("session-one");
    await assert.rejects(checkOtp("9000000002", code, "session-one", connect), /Invalid or expired OTP/);
    await checkOtp(phone, code, "session-one", connect);
    await assert.rejects(checkOtp(phone, code, "session-one", connect), /Invalid or expired OTP/);
    await save("session-guesses");
    for (let attempt = 0; attempt < 5; attempt++) await assert.rejects(checkOtp(phone, "000000", "session-guesses", connect), /Invalid or expired OTP/);
    await assert.rejects(checkOtp(phone, code, "session-guesses", connect), /Invalid or expired OTP/);
    await save("session-expired");
    await db.exec(`UPDATE otp_sessions SET expires_at = now() - interval '1 minute' WHERE session_id = 'session-expired'`);
    await assert.rejects(checkOtp(phone, code, "session-expired", connect), /Invalid or expired OTP/);
    assert.equal((await db.query(`SELECT * FROM otp_sessions WHERE session_id = 'session-expired'`)).rows.length, 0);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
    await db.close();
  }
});

test("PostgreSQL blocks enforce both directions, isolate ownership, and permit unblocking", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE authenticated; CREATE ROLE anon;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE TABLE accounts (id uuid PRIMARY KEY);
      CREATE TABLE user_profiles (id uuid PRIMARY KEY, full_name text);
      CREATE TABLE properties (id uuid PRIMARY KEY, owner_id uuid REFERENCES accounts(id) ON DELETE CASCADE);
      CREATE TABLE conversations (id uuid PRIMARY KEY, buyer_id uuid REFERENCES accounts(id) ON DELETE CASCADE, owner_id uuid REFERENCES accounts(id) ON DELETE CASCADE, property_id uuid REFERENCES properties(id) ON DELETE CASCADE);
      CREATE TABLE chat_messages (id uuid PRIMARY KEY, conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE, sender_id uuid, body text);
      CREATE TABLE chat_message_reactions (message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE, user_id uuid, emoji text);
      CREATE TABLE property_inquiries (property_id uuid, buyer_id uuid);
      CREATE TABLE property_visits (property_id uuid, buyer_id uuid);
      CREATE TABLE property_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE, reported_by uuid, reason text);
      GRANT SELECT, INSERT, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      INSERT INTO accounts VALUES ('${buyer}'), ('${owner}'), ('${stranger}');
      INSERT INTO properties VALUES ('${buyer}', '${owner}');
      INSERT INTO conversations VALUES ('${buyer}', '${buyer}', '${owner}', '${buyer}');
      INSERT INTO chat_messages VALUES ('${buyer}', '${buyer}', '${owner}', 'original message');
    `);
    for (const file of ["047_user_safety.sql", "048_account_cleanup.sql", "049_play_billing.sql", "050_moderation.sql", "051_auth_rate_limits.sql"]) await db.exec(await fs.readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '${buyer}', false); INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${buyer}', '${owner}');`);
    await assert.rejects(db.exec(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${owner}', '${stranger}')`), /row-level security/);
    await assert.rejects(db.exec(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${buyer}', '${buyer}')`), /check constraint/);
    await assert.rejects(db.exec(`INSERT INTO chat_messages VALUES ('${owner}', '${buyer}', '${buyer}', 'blocked')`), /user is blocked/);
    await assert.rejects(db.exec(`INSERT INTO chat_message_reactions VALUES ('${buyer}', '${buyer}', 'x')`), /user is blocked/);
    await assert.rejects(db.exec(`INSERT INTO property_inquiries VALUES ('${buyer}', '${buyer}')`), /user is blocked/);
    await assert.rejects(db.exec(`INSERT INTO property_visits VALUES ('${buyer}', '${buyer}')`), /user is blocked/);
    await assert.rejects(db.exec(`INSERT INTO conversations VALUES ('${owner}', '${buyer}', '${owner}', '${buyer}')`), /user is blocked/);
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${stranger}', false)`);
    assert.equal((await db.query<{ blocked: boolean }>(`SELECT public.users_blocked('${buyer}', '${owner}') AS blocked`)).rows[0].blocked, false);
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${owner}', false)`);
    assert.equal((await db.query(`SELECT * FROM user_blocks`)).rows.length, 0);
    await assert.rejects(db.exec(`INSERT INTO chat_messages VALUES ('${owner}', '${buyer}', '${owner}', 'also blocked')`), /user is blocked/);
    await db.exec(`DELETE FROM user_blocks WHERE blocker_id = '${buyer}'`);
    assert.equal((await db.query<{ blocked: boolean }>(`SELECT public.users_blocked('${buyer}', '${owner}') AS blocked`)).rows[0].blocked, true);
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${buyer}', false); DELETE FROM user_blocks WHERE blocker_id = auth.uid(); INSERT INTO chat_messages VALUES ('${owner}', '${buyer}', '${buyer}', 'allowed again');`);
    await db.exec(`RESET ROLE; INSERT INTO property_reports (reported_by, reported_user_id, reason) VALUES ('${buyer}', '${owner}', 'fraud');`);
    assert.equal((await db.query(`SELECT * FROM property_reports WHERE property_id IS NULL`)).rows.length, 1);
    await db.exec(`UPDATE accounts SET suspended_at = now() WHERE id = '${owner}'`);
    assert.equal((await db.query<{ active: boolean }>(`SELECT public.account_active('${owner}') AS active`)).rows[0].active, false);
    assert.equal((await db.query<{ active: boolean }>(`SELECT public.account_active('${stranger}') AS active`)).rows[0].active, true);
    // Token uniqueness and queue ownership survive account deletion.
    await db.exec(`INSERT INTO user_uploads VALUES ('property/image/test.jpg', '${buyer}', 'https://media.example.com/property/image/test.jpg', now()); INSERT INTO storage_deletion_jobs (remote_key) VALUES ('property/image/test.jpg'); INSERT INTO play_purchases (token_hash, user_id, product_id, credits) VALUES ('hash', '${buyer}', 'propertysetu_credits_20', 20); DELETE FROM accounts WHERE id = '${buyer}';`);
    assert.equal((await db.query(`SELECT * FROM user_uploads`)).rows.length, 0);
    assert.equal((await db.query(`SELECT * FROM storage_deletion_jobs`)).rows.length, 1);
    assert.equal((await db.query<{ user_id: null }>(`SELECT user_id FROM play_purchases`)).rows[0].user_id, null);
    await assert.rejects(db.exec(`INSERT INTO play_purchases (token_hash, product_id, credits) VALUES ('hash', 'propertysetu_credits_20', 20)`), /duplicate key/);
  } finally { await db.close(); await pool.end(); }
});
