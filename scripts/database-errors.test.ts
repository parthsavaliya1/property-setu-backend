import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { errorHandler } from "../src/http.js";

test("database capacity errors return retryable availability errors, not login failures", t => {
  t.mock.method(console, "error", () => undefined);
  t.mock.method(console, "warn", () => undefined);
  for (const error of [
    Object.assign(new Error("(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15"), { code: "XX000" }),
    Object.assign(new Error("too many clients already"), { code: "53300" }),
  ]) {
    let status = 0;
    let retry: string | undefined;
    let payload: { code?: string } = {};
    const response = {
      setHeader(name: string, value: string) { if (name === "Retry-After") retry = value; return response; },
      status(value: number) { status = value; return response; },
      json(value: object) { payload = value; return response; },
    };
    errorHandler(error, { method: "POST", originalUrl: "/api/auth/login" } as Request, response as unknown as Response, () => undefined);
    assert.equal(status, 503);
    assert.equal(retry, "5");
    assert.equal(payload.code, "database_busy");
  }
});
