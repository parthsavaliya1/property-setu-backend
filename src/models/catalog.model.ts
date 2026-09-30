import type { Db } from "../db.js";

export const CatalogModel = {
  async categories(db: Db) {
    const result = await db.query(
      `SELECT c.id, c.parent_id, c.name, c.slug, c.description, c.icon, c.image_url, c.sort_order, c.is_active
       FROM property_categories c
       LEFT JOIN property_categories parent ON parent.id = c.parent_id
       ORDER BY COALESCE(parent.sort_order, c.sort_order), c.parent_id NULLS FIRST, c.sort_order, c.name`
    );
    return result.rows;
  },

  async amenities(db: Db) {
    const result = await db.query(
      `SELECT id, name, slug, category, icon
       FROM amenities
       WHERE is_active
       ORDER BY category, name`
    );
    return result.rows;
  },

  async plans(db: Db) {
    const result = await db.query(
      `SELECT id, name, description, price, duration_days, property_limit, featured_property_limit
       FROM subscription_plans
       WHERE is_active
       ORDER BY price`
    );
    return result.rows;
  },
};
