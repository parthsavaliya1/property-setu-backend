import { z } from "zod";
import { pool, withDb, type Db } from "../db.js";
import { HttpError } from "../errors.js";
import { asyncRoute } from "../http.js";
import { CatalogModel } from "../models/catalog.model.js";
import { PropertyModel, type PropertyWrite } from "../models/property.model.js";
import { UserModel } from "../models/user.model.js";
import { razorpayConfigured } from "../services/razorpay.js";

const listingType = z.enum(["sale", "rent", "lease", "pg"]);
const status = z.enum([
  "draft", "pending_review", "published", "rejected", "sold", "rented", "expired", "archived",
]);

const propertyBody = z.object({
  category_id: z.string().uuid().optional(),
  category_slug: z.string().optional(),
  title: z.string().trim().min(3).max(160),
  description: z.string().max(8000).optional(),
  listing_type: listingType.default("sale"),
  property_type: z.string().max(80).optional(),
  price: z.number().nonnegative().optional(),
  price_unit: z.string().max(40).optional(),
  is_price_negotiable: z.boolean().optional(),
  area: z.number().nonnegative().optional(),
  area_unit: z.enum(["sq_ft", "sq_yd", "sq_m", "acre", "hectare", "guntha", "bigha"]).optional(),
  built_up_area: z.number().nonnegative().optional(),
  carpet_area: z.number().nonnegative().optional(),
  plot_area: z.number().nonnegative().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  balconies: z.number().int().nonnegative().optional(),
  floor_number: z.number().int().nonnegative().optional(),
  total_floors: z.number().int().nonnegative().optional(),
  parking_spaces: z.number().int().nonnegative().optional(),
  furnishing_status: z.enum(["unfurnished", "semi_furnished", "furnished"]).optional(),
  construction_year: z.number().int().min(1800).max(2200).optional(),
  possession_status: z.string().max(80).optional(),
  facing: z.string().max(40).optional(),
  status: status.optional(),
  agency_id: z.string().uuid().nullable().optional(),
  agent_id: z.string().uuid().nullable().optional(),
  location: z.object({
    address: z.string().max(300).optional(),
    address_line_2: z.string().max(300).optional(),
    locality: z.string().max(120).optional(),
    area: z.string().max(120).optional(),
    landmark: z.string().max(160).optional(),
    village: z.string().max(120).optional(),
    taluka: z.string().max(120).optional(),
    city: z.string().max(120).optional(),
    district: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    pincode: z.string().max(12).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }).optional(),
  images: z.array(z.object({
    image_url: z.string().url(),
    thumbnail_url: z.string().url().optional(),
    image_type: z.string().optional(),
    is_cover: z.boolean().optional(),
    sort_order: z.number().int().optional(),
  })).max(30).optional(),
  amenity_ids: z.array(z.string().uuid()).max(50).optional(),
  features: z.array(z.object({
    feature_key: z.string().min(1).max(80),
    feature_value: z.string().max(300).optional(),
  })).max(40).optional(),
  pricing: z.object({
    price: z.number().nonnegative(),
    price_type: z.enum(["sale", "monthly_rent", "yearly_rent", "lease", "per_sqft", "all_inclusive"]).optional(),
    maintenance_charge: z.number().nonnegative().optional(),
    maintenance_period: z.enum(["monthly", "quarterly", "yearly"]).optional(),
    security_deposit: z.number().nonnegative().optional(),
    negotiable: z.boolean().optional(),
  }).optional(),
  documents: z.array(z.object({
    document_type: z.enum([
      "sale_deed", "7_12", "property_card", "na_order", "tax_receipt",
      "rera_certificate", "ownership_proof", "building_permission", "other",
    ]),
    document_url: z.string().url(),
  })).max(20).optional(),
  listing_badge: z.enum(["standard", "premium", "featured"]).optional(),
});

const profileBody = z.object({
  full_name: z.string().max(120).optional(),
  phone: z.string().max(20).optional(),
  avatar_url: z.string().url().nullable().optional(),
  bio: z.string().max(1000).optional(),
  city: z.string().max(120).optional(),
  district: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  pincode: z.string().max(12).optional(),
});

function userId(req: { user?: { id: string } }) {
  return req.user?.id ?? null;
}

export async function expireDueListings() {
  let client: Db | null = null;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      `UPDATE properties
       SET expires_at = COALESCE(published_at, created_at) + interval '1 month'
       WHERE status = 'published' AND expires_at IS NULL`
    );
    await client.query(
      `UPDATE properties
       SET status = 'expired'
       WHERE status = 'published' AND expires_at <= now()`
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client?.query("ROLLBACK");
    } catch {
      /* list can still run if expiry could not be saved */
    }
    console.error(error instanceof Error && error.message ? error.message : "Could not expire listings");
  } finally {
    client?.release();
  }
}

export const CatalogController = {
  health: asyncRoute(async (_req, res) => {
    res.json({
      ok: true,
      authConfigured: Boolean(process.env.JWT_SECRET),
      paymentsConfigured: razorpayConfigured(),
    });
  }),

  categories: asyncRoute(async (req, res) => {
    const rows = await withDb(userId(req), (db) => CatalogModel.categories(db));
    res.json(rows);
  }),

  amenities: asyncRoute(async (req, res) => {
    const rows = await withDb(userId(req), (db) => CatalogModel.amenities(db));
    res.json(rows);
  }),

  plans: asyncRoute(async (req, res) => {
    const rows = await withDb(userId(req), (db) => CatalogModel.plans(db));
    res.json(rows);
  }),
};

export const PropertyController = {
  list: asyncRoute(async (req, res) => {
    const query = z.object({
      q: z.string().trim().optional(),
      listing_type: listingType.optional(),
      category: z.string().optional(),
      city: z.string().optional(),
      prefer_city: z.string().trim().optional(),
      city_first: z.enum(["true", "false"]).optional(),
      listing_tier: z.enum(["premium", "standard"]).optional(),
      min_price: z.coerce.number().optional(),
      max_price: z.coerce.number().optional(),
      bedrooms: z.coerce.number().int().optional(),
      featured: z.enum(["true", "false"]).optional(),
      mine: z.enum(["true", "false"]).optional(),
      status: status.optional(),
      lat: z.coerce.number().optional(),
      lng: z.coerce.number().optional(),
      radius_km: z.coerce.number().positive().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    if (query.mine === "true" && !req.user) throw new HttpError(401, "Sign in required");
    await expireDueListings();

    const rows = await withDb(userId(req), (db) =>
      PropertyModel.list(db, { ...query, ownerId: req.user?.id }, Boolean(req.user))
    );
    res.json(rows);
  }),

  show: asyncRoute(async (req, res) => {
    await expireDueListings();
    const property = await withDb(userId(req), (db) =>
      PropertyModel.findDetail(db, req.params.id, Boolean(req.user))
    );
    if (!property) throw new HttpError(404, "Property not found");
    res.json(property);
  }),

  create: asyncRoute(async (req, res) => {
    const body = propertyBody.parse(req.body) as PropertyWrite;
    const photos = (body.images || []).filter((image) => image.image_type !== "video");
    if (photos.length < 2) throw new HttpError(400, "Add at least 2 photos.");
    const created = await withDb(req.user!.id, (db) => PropertyModel.create(db, { ...body, status: "draft" }));
    res.status(201).json(created);
  }),

  update: asyncRoute(async (req, res) => {
    const body = propertyBody.partial().parse(req.body) as PropertyWrite;
    if (body.images) {
      const photos = body.images.filter((image) => image.image_type !== "video");
      if (photos.length < 2) throw new HttpError(400, "Add at least 2 photos.");
    }
    if (body.status === "published") {
      const current = await withDb(req.user!.id, (db) => PropertyModel.find(db, req.params.id, false));
      const expires = current?.expires_at ? new Date(current.expires_at).getTime() : null;
      const live = current?.status === "published" && (expires == null || expires > Date.now());
      if (!live) delete body.status;
    }
    const updated = await withDb(req.user!.id, (db) => PropertyModel.update(db, req.params.id, body));
    if (!updated) throw new HttpError(404, "Property not found");
    res.json(updated);
  }),

  remove: asyncRoute(async (req, res) => {
    const hard = req.query.hard === "true";
    const existing = await withDb(req.user!.id, (db) => PropertyModel.find(db, req.params.id, false));
    if (!existing || existing.owner_id !== req.user!.id) throw new HttpError(404, "Property not found");
    if (!hard) {
      const result = await withDb(req.user!.id, (db) => PropertyModel.remove(db, req.params.id, false));
      if (!result) throw new HttpError(404, "Property not found");
      res.json(result);
      return;
    }
    const client = await pool.connect();
    try {
      const result = await client.query(`DELETE FROM public.properties WHERE id = $1 AND owner_id = $2`, [existing.id, req.user!.id]);
      if (!result.rowCount) throw new HttpError(404, "Property not found");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const code = (error as { code?: string }).code;
      if (code === "23503") throw new HttpError(409, "This property cannot be deleted yet");
      throw error;
    } finally {
      client.release();
    }
    res.json({ id: existing.id, archived: false });
  }),

  view: asyncRoute(async (req, res) => {
    const device = z.object({
      device_type: z.enum(["web", "ios", "android", "other"]).optional(),
    }).parse(req.body ?? {});
    await withDb(userId(req), (db) =>
      PropertyModel.recordView(db, req.params.id, device.device_type ?? "other")
    );
    res.status(204).end();
  }),
};

export const UserController = {
  me: asyncRoute(async (req, res) => {
    const me = await withDb(req.user!.id, (db) => UserModel.me(db));
    res.json(me);
  }),

  update: asyncRoute(async (req, res) => {
    const body = profileBody.parse(req.body);
    const profile = await withDb(req.user!.id, (db) => UserModel.updateProfile(db, body));
    res.json(profile);
  }),

  remove: asyncRoute(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM public.properties WHERE owner_id = $1`, [req.user!.id]);
      const result = await client.query(`DELETE FROM public.accounts WHERE id = $1`, [req.user!.id]);
      if (!result.rowCount) throw new HttpError(404, "Account not found");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (error instanceof HttpError) throw error;
      const code = (error as { code?: string }).code;
      if (code === "23503") throw new HttpError(409, "This account cannot be deleted yet");
      throw error;
    } finally {
      client.release();
    }
    res.status(204).end();
  }),
};
