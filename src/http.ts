import type { NextFunction, Request, Response } from "express";
import type { DatabaseError } from "pg";
import { ZodError } from "zod";
import { HttpError } from "./errors.js";

export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function requestLog(req: Request, res: Response, next: NextFunction) {
  const started = Date.now();
  console.log(`[request] Incoming ${req.method} ${req.path}`);
  res.on("finish", () => {
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`;
    if (res.statusCode >= 500) console.error(`[request] ${line}`);
    else if (res.statusCode >= 400) console.warn(`[request] ${line}`);
    else console.log(`[request] ${line}`);
  });
  next();
}

function logFailure(req: Request, status: number, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const where = `${req.method} ${req.originalUrl}`;
  if (status >= 500) {
    console.error(`[error] ${where} status=${status}${code ? ` code=${code}` : ""} ${message}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
    return;
  }
  console.warn(`[issue] ${where} status=${status}${code ? ` code=${code}` : ""} ${message}`);
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    logFailure(req, error.status, error);
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }

  const pgError = error as DatabaseError;
  const status = (error as { status?: number }).status;

  if (status) {
    logFailure(req, status, error);
    res.status(status).json({
      error: error instanceof Error ? error.message : "Request failed",
      code: (error as { code?: string }).code,
    });
    return;
  }

  if (pgError?.code === "42501") {
    logFailure(req, 403, error);
    res.status(403).json({ error: "You do not have permission to do that" });
    return;
  }
  if (pgError?.code === "23514") {
    logFailure(req, 400, error);
    res.status(400).json({ error: pgError.message || "Invalid value" });
    return;
  }
  if (pgError?.code === "23505") {
    logFailure(req, 409, error);
    res.status(409).json({ error: "That record already exists" });
    return;
  }
  if (pgError?.code === "23503") {
    logFailure(req, 400, error);
    res.status(400).json({ error: "Related record was not found" });
    return;
  }
  if (error instanceof ZodError) {
    logFailure(req, 400, error);
    res.status(400).json({ error: error.issues[0]?.message || "Check the form and try again" });
    return;
  }

  if (isConnectionTimeout(error)) {
    logFailure(req, 503, error);
    res.status(503).json({ error: "Could not reach the database. Try again." });
    return;
  }

  logFailure(req, 500, error);
  res.status(500).json({ error: "Something went wrong" });
}

function isConnectionTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ENETUNREACH") return true;
  const nested = (error as { errors?: unknown[] }).errors;
  return Array.isArray(nested) && nested.some((item) => isConnectionTimeout(item));
}
