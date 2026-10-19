import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";

export type AuthUser = {
  id: string;
  email: string | null;
  phone?: string | null;
  suspended?: boolean;
};

type TokenBody = {
  id?: string;
  email?: string | null;
};

export function signToken(user: AuthUser) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const error = new Error("JWT_SECRET is not set") as Error & { status?: number };
    error.status = 503;
    throw error;
  }
  return jwt.sign({ id: user.id, email: user.email }, secret, { expiresIn: "365d" });
}

export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const error = new Error("JWT_SECRET is not set") as Error & { status?: number };
    error.status = 503;
    throw error;
  }
  try {
    const body = jwt.verify(token, secret) as TokenBody;
    if (!body.id) throw new Error("Invalid session");
    const account = await pool.query(`SELECT id, suspended_at FROM accounts WHERE id = $1`, [body.id]);
    if (!account.rowCount) throw new Error("Account no longer exists");
    return { id: body.id, email: body.email ?? null, suspended: Boolean(account.rows[0].suspended_at) };
  } catch (err) {
    const error = new Error("Invalid or expired session") as Error & { status?: number };
    error.status = 401;
    if ((err as { status?: number }).status) throw err;
    throw error;
  }
}

export async function optionalUser(req: Request, _res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    next();
    return;
  }
  try {
    req.user = await verifyAccessToken(header.slice(7).trim());
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  try {
    req.user = await verifyAccessToken(header.slice(7).trim());
    if (req.user.suspended && !((req.method === "DELETE" || req.method === "GET") && req.path === "/me")) {
      res.status(403).json({ error: "This account is suspended. Contact PropertySetu support. Account deletion remains available." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
