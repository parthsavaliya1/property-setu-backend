import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import cors from "cors";
import { isAllowedBrowserOrigin } from "../src/corsOrigin.js";

test("production admin login preflight allows the website and rejects unrelated origins", async () => {
  const previousMode = process.env.NODE_ENV;
  const previousOrigins = process.env.CORS_ORIGIN;
  process.env.NODE_ENV = "production";
  delete process.env.CORS_ORIGIN;
  const origin = "https://property-setu-ps.vercel.app";
  const app = express();
  app.use(cors({ origin(value, callback) { callback(null, isAllowedBrowserOrigin(value)); } }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/auth/login`;
    const preflight = (value: string) => fetch(url, {
      method: "OPTIONS",
      headers: { Origin: value, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" },
    });
    const allowed = await preflight(origin);
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), origin);
    assert.match(allowed.headers.get("access-control-allow-headers") ?? "", /authorization/);
    for (const value of ["https://untrusted.example", `${origin}.attacker.example`]) {
      const denied = await preflight(value);
      assert.equal(denied.headers.get("access-control-allow-origin"), null);
    }
    process.env.CORS_ORIGIN = "https://extra.example";
    assert.equal(isAllowedBrowserOrigin("https://extra.example"), true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
    if (previousOrigins === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previousOrigins;
  }
});
