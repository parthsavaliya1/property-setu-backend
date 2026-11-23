import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PropertyModel } from "../src/models/property.model.js";
import type { Db } from "../src/db.js";

test("parking search returns houses with recorded parking and composes with category and listing type", async () => {
  const db = new PGlite();
  const client = { query: db.query.bind(db) } as unknown as Db;
  try {
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS text LANGUAGE sql AS $$ SELECT NULL::text $$;
      CREATE FUNCTION public.users_blocked(text,text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.account_active(text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE TABLE properties (
        id text, owner_id text, agency_id text, agent_id text, category_id text, title text, slug text,
        description text, listing_type text, property_type text, price numeric, price_unit text,
        is_price_negotiable boolean, area numeric, area_unit text, built_up_area numeric, carpet_area numeric,
        plot_area numeric, bedrooms int, bathrooms int, balconies int, floor_number int, total_floors int,
        parking_spaces int, furnishing_status text, construction_year int, possession_status text,
        facing text, status text, verification_status text, is_featured boolean DEFAULT false, is_premium boolean DEFAULT false,
        published_at timestamptz, expires_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz
      );
      CREATE TABLE property_categories (id text, parent_id text, name text, slug text);
      CREATE TABLE amenities (id text, slug text);
      CREATE TABLE property_amenities (property_id text, amenity_id text);
      CREATE TABLE property_features (property_id text, feature_key text, feature_value text);
      CREATE TABLE property_images (property_id text, image_url text, is_cover boolean, sort_order int, created_at timestamptz);
      CREATE TABLE property_locations (property_id text, address text, address_line_2 text, locality text, area text, landmark text,
        village text, taluka text, city text, district text, state text, country text, pincode text, latitude numeric, longitude numeric);
      CREATE TABLE user_profiles (id text, full_name text, avatar_url text, city text, is_verified boolean);
      INSERT INTO property_categories (id, name, slug) VALUES ('house', 'House', 'house'), ('villa', 'Villa', 'villa'), ('commercial', 'Commercial', 'commercial'), ('shop', 'Shop', 'shop'), ('commercial-plot', 'Commercial Plot', 'commercial-plot');
      UPDATE property_categories SET parent_id = 'commercial' WHERE id = 'shop';
      INSERT INTO properties (id, category_id, title, listing_type, status, parking_spaces) VALUES
        ('one-space', 'house', 'One space', 'sale', 'published', 1),
        ('two-spaces', 'house', 'Two spaces', 'sale', 'published', 2),
        ('no-parking', 'house', 'No parking', 'sale', 'published', 0),
        ('unknown', 'house', 'Unknown parking', 'sale', 'published', NULL),
        ('amenity-parking', 'house', 'Parking amenity', 'sale', 'published', NULL),
        ('rental', 'house', 'Rental house', 'rent', 'published', 1),
        ('villa', 'villa', 'Villa', 'sale', 'published', 1),
        ('shop', 'shop', 'Shop', 'sale', 'published', 0),
        ('commercial-plot', 'commercial-plot', 'Commercial Plot', 'sale', 'published', 0);
      INSERT INTO amenities VALUES ('parking', 'parking'), ('visitor', 'visitor-parking');
      INSERT INTO property_amenities VALUES ('amenity-parking', 'parking'), ('no-parking', 'visitor');
    `);
    const base = { category: "house", listing_type: "sale", limit: 20, offset: 0 };
    const ids = (rows: Array<{ id: string }>) => rows.map(row => row.id).sort();
    assert.deepEqual(ids(await PropertyModel.list(client, { ...base, parking: "true" }, false)), ['amenity-parking', 'one-space', 'two-spaces']);
    assert.deepEqual(ids(await PropertyModel.list(client, { ...base, parking: "false" }, false)), ['amenity-parking', 'no-parking', 'one-space', 'two-spaces', 'unknown']);
    assert.deepEqual(ids(await PropertyModel.list(client, base, false)), ['amenity-parking', 'no-parking', 'one-space', 'two-spaces', 'unknown']);
    assert.deepEqual(ids(await PropertyModel.list(client, { ...base, listing_type: "rent", parking: "true" }, false)), ['rental']);
    assert.deepEqual(ids(await PropertyModel.list(client, { category: 'commercial', limit: 20, offset: 0 }, false)), ['commercial-plot', 'shop']);
  } finally { await db.close(); }
});
