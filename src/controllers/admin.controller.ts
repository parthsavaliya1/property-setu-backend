import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, withDb } from "../db.js";
import { HttpError } from "../errors.js";
import { asyncRoute } from "../http.js";
import { AdminModel } from "../models/admin.model.js";
import { UserModel } from "../models/user.model.js";
import { listingSettings, saveListingSettings } from "../services/appSettings.js";
import { appTheme, isThemeKey, saveAppTheme, THEME_KEYS } from "../services/appTheme.js";

async function assertAdmin(userId: string) {
  const allowed = await withDb(userId, (db) => UserModel.isAdmin(db));
  if (!allowed) throw new HttpError(403, "Admin access required");
}

export const AdminController = {
  suspendUser: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const id = z.string().uuid().parse(req.params.id);
    const body = z.object({ suspended: z.boolean() }).parse(req.body);
    if (id === req.user!.id) throw new HttpError(400, "You cannot suspend your own account");
    if (await withDb(id, db => UserModel.isAdmin(db))) throw new HttpError(403, "Administrator accounts cannot be suspended here");
    const result = await pool.query(`UPDATE accounts SET suspended_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1 RETURNING id, suspended_at`, [id, body.suspended]);
    if (!result.rowCount) throw new HttpError(404, "Account not found");
    res.json(result.rows[0]);
  }),
  stats: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const stats = await withDb(req.user!.id, (db) => AdminModel.stats(db));
    res.json(stats);
  }),

  properties: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const rows = await withDb(req.user!.id, (db) => AdminModel.properties(db));
    res.json(rows);
  }),

  updateProperty: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({
      status: z.enum(["draft", "pending_review", "published", "rejected", "sold", "rented", "expired", "archived"]).optional(),
      verification_status: z.enum(["pending", "submitted", "verified", "rejected", "active"]).optional(),
      is_featured: z.boolean().optional(),
      is_premium: z.boolean().optional(),
    }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => AdminModel.updateProperty(db, req.params.id, body));
    if (!row) throw new HttpError(404, "Property not found");
    res.json(row);
  }),

  users: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const rows = await withDb(req.user!.id, (db) => AdminModel.users(db));
    res.json(rows);
  }),

  payments: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const rows = await withDb(req.user!.id, (db) => AdminModel.payments(db));
    res.json(rows);
  }),

  reports: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const rows = await withDb(req.user!.id, (db) => AdminModel.reports(db));
    res.json(rows);
  }),

  updateReport: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({ status: z.enum(["pending", "reviewing", "resolved", "dismissed"]) }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => AdminModel.updateReport(db, req.params.id, body.status));
    if (!row) throw new HttpError(404, "Report not found");
    res.json(row);
  }),

  updateDocument: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({
      verification_status: z.enum(["pending", "submitted", "verified", "rejected"]),
    }).parse(req.body);
    const row = await withDb(req.user!.id, (db) => AdminModel.updateDocument(db, req.params.id, body.verification_status));
    if (!row) throw new HttpError(404, "Document not found");
    res.json(row);
  }),

  listingSettings: asyncRoute(async (_req, res) => {
    res.json(await listingSettings());
  }),

  appTheme: asyncRoute(async (_req, res) => {
    res.json({ theme: await appTheme(), themes: THEME_KEYS });
  }),

  updateAppTheme: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({ theme: z.string() }).parse(req.body);
    if (!isThemeKey(body.theme)) {
      throw new HttpError(400, `theme must be one of: ${THEME_KEYS.join(", ")}`);
    }
    const theme = await saveAppTheme(body.theme);
    res.json({ theme, themes: THEME_KEYS });
  }),

  updateListingSettings: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({
      standard_price: z.number().int().min(0).max(100000),
      premium_price: z.number().int().min(0).max(100000),
      premium_offer_percent: z.number().int().min(0).max(90),
      yearly_discount_percent: z.number().int().min(0).max(90),
    }).parse(req.body);
    const saved = await saveListingSettings({
      standardPrice: body.standard_price,
      premiumPrice: body.premium_price,
      premiumOfferPercent: body.premium_offer_percent,
      yearlyDiscountPercent: body.yearly_discount_percent,
    });
    res.json(saved);
  }),

  demoUsers: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const rows = await pool.query(
      `SELECT id, phone, otp, full_name, active, created_at
       FROM public.demo_users
       ORDER BY created_at DESC`
    );
    res.json(rows.rows);
  }),

  createDemoUser: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({
      phone: z.string().trim().regex(/^\d{10}$/, "Enter a 10-digit mobile number"),
      otp: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit OTP"),
      full_name: z.string().trim().min(2).max(80),
    }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM public.accounts WHERE phone = $1`,
        [body.phone]
      );
      const accountId = existing.rows[0]?.id || randomUUID();
      if (!existing.rows[0]) {
        const passwordHash = await bcrypt.hash(randomUUID(), 10);
        await client.query(
          `INSERT INTO public.accounts (id, email, phone, password_hash, password_set, email_verified, email_verified_at)
           VALUES ($1, NULL, $2, $3, false, true, now())`,
          [accountId, body.phone, passwordHash]
        );
        await client.query(
          `INSERT INTO public.user_profiles (id, full_name, phone) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone`,
          [accountId, body.full_name, body.phone]
        );
        await client.query(
          `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'buyer') ON CONFLICT DO NOTHING`,
          [accountId]
        );
      }
      const created = await client.query(
        `INSERT INTO public.demo_users (phone, otp, full_name, active)
         VALUES ($1, $2, $3, true)
         RETURNING id, phone, otp, full_name, active, created_at`,
        [body.phone, body.otp, body.full_name]
      );
      await client.query("COMMIT");
      res.status(201).json(created.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") {
        throw new HttpError(409, "This number is already a demo user.");
      }
      throw error;
    } finally {
      client.release();
    }
  }),

  updateDemoUser: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const body = z.object({
      otp: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit OTP").optional(),
      full_name: z.string().trim().min(2).max(80).optional(),
      active: z.boolean().optional(),
    }).parse(req.body);
    const row = await pool.query(
      `UPDATE public.demo_users
       SET otp = COALESCE($2, otp),
           full_name = COALESCE($3, full_name),
           active = COALESCE($4, active)
       WHERE id = $1
       RETURNING id, phone, otp, full_name, active, created_at`,
      [req.params.id, body.otp ?? null, body.full_name ?? null, body.active ?? null]
    );
    if (!row.rows[0]) throw new HttpError(404, "Demo user not found");
    res.json(row.rows[0]);
  }),

  deleteDemoUser: asyncRoute(async (req, res) => {
    await assertAdmin(req.user!.id);
    const row = await pool.query(`DELETE FROM public.demo_users WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!row.rows[0]) throw new HttpError(404, "Demo user not found");
    res.status(204).end();
  }),
};
