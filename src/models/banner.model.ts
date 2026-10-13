import type { Db } from "../db.js";

export type HomeBanner = {
  id: string;
  image_url: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

const columns = "id, image_url, is_active, sort_order, created_at";

export const BannerModel = {
  async listActive(db: Db) {
    const result = await db.query<HomeBanner>(
      `SELECT ${columns}
       FROM home_banners
       WHERE is_active = true
       ORDER BY sort_order, created_at`
    );
    return result.rows;
  },

  async listAll(db: Db) {
    const result = await db.query<HomeBanner>(
      `SELECT ${columns}
       FROM home_banners
       ORDER BY sort_order, created_at`
    );
    return result.rows;
  },

  async create(db: Db, imageUrl: string) {
    const result = await db.query<HomeBanner>(
      `INSERT INTO home_banners (image_url, sort_order)
       VALUES ($1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM home_banners))
       RETURNING ${columns}`,
      [imageUrl]
    );
    return result.rows[0] ?? null;
  },

  async update(db: Db, id: string, isActive: boolean) {
    const result = await db.query<HomeBanner>(
      `UPDATE home_banners
       SET is_active = $2
       WHERE id = $1
       RETURNING ${columns}`,
      [id, isActive]
    );
    return result.rows[0] ?? null;
  },

  async remove(db: Db, id: string) {
    const result = await db.query<{ id: string }>(
      "DELETE FROM home_banners WHERE id = $1 RETURNING id",
      [id]
    );
    return result.rows[0] ?? null;
  },
};
