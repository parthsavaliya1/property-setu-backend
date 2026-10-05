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

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }

  const pgError = error as DatabaseError;
  const status = (error as { status?: number }).status;

  if (status) {
    res.status(status).json({
      error: error instanceof Error ? error.message : "Request failed",
      code: (error as { code?: string }).code,
    });
    return;
  }

  if (pgError?.code === "42501") {
    res.status(403).json({ error: "You do not have permission to do that" });
    return;
  }
  if (pgError?.code === "23514") {
    res.status(400).json({ error: pgError.message || "Invalid value" });
    return;
  }
  if (pgError?.code === "23505") {
    res.status(409).json({ error: "That record already exists" });
    return;
  }
  if (pgError?.code === "23503") {
    res.status(400).json({ error: "Related record was not found" });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues[0]?.message || "Check the form and try again" });
    return;
  }

  if (isConnectionTimeout(error)) {
    console.error("Database connection timed out");
    res.status(503).json({ error: "Could not reach the database. Try again." });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Something went wrong" });
}

function isConnectionTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: string }).code;
  if (code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ENETUNREACH") return true;
  const nested = (error as { errors?: unknown[] }).errors;
  return Array.isArray(nested) && nested.some((item) => isConnectionTimeout(item));
}
