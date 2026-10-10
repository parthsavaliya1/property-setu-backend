import type { Db } from "../db.js";

export const AdminModel = {
  async stats(db: Db) {
    const result = await db.query(`
      SELECT
        (SELECT count(*) FROM properties) AS properties,
        (SELECT count(*) FROM properties WHERE status = 'published') AS published,
        (SELECT count(*) FROM properties WHERE status = 'pending_review') AS pending_review,
        (SELECT count(*) FROM property_inquiries) AS inquiries,
        (SELECT count(*) FROM property_reports WHERE status = 'pending') AS open_reports,
        (SELECT count(*) FROM user_profiles) AS users,
        (SELECT coalesce(sum(amount), 0) FROM payments WHERE status = 'paid') AS revenue,
        (SELECT count(*) FROM property_views) AS views
    `);
    return result.rows[0];
  },

  async properties(db: Db) {
    const result = await db.query(
      `SELECT p.id, p.title, p.slug, p.status, p.verification_status, p.price, p.listing_type,
              p.is_featured, p.created_at, l.city, pr.full_name AS owner_name
       FROM properties p
       LEFT JOIN property_locations l ON l.property_id = p.id
       LEFT JOIN user_profiles pr ON pr.id = p.owner_id
       ORDER BY p.created_at DESC
       LIMIT 500`
    );
    return result.rows;
  },

  async updateProperty(db: Db, id: string, input: { status?: string; verification_status?: string; is_featured?: boolean; is_premium?: boolean }) {
    const result = await db.query(
      `UPDATE properties SET
        status = COALESCE($2, status),
        verification_status = COALESCE($3, verification_status),
        is_featured = COALESCE($4, is_featured),
        is_premium = COALESCE($5, is_premium)
      WHERE id = $1
      RETURNING id, status, verification_status, is_featured, is_premium`,
      [id, input.status ?? null, input.verification_status ?? null, input.is_featured ?? null, input.is_premium ?? null]
    );
    return result.rows[0] ?? null;
  },

  async reports(db: Db) {
    const result = await db.query(
      `SELECT r.*, p.title AS property_title
       FROM property_reports r
       JOIN properties p ON p.id = r.property_id
       ORDER BY r.created_at DESC
       LIMIT 500`
    );
    return result.rows;
  },

  async updateReport(db: Db, id: string, status: string) {
    const result = await db.query(
      `UPDATE property_reports
       SET status = $2, reviewed_by = auth.uid(), reviewed_at = now()
       WHERE id = $1 RETURNING *`,
      [id, status]
    );
    return result.rows[0] ?? null;
  },

  async updateDocument(db: Db, id: string, verificationStatus: string) {
    const result = await db.query(
      `UPDATE property_documents
       SET verification_status = $2,
           verified_by = auth.uid(),
           verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE verified_at END
       WHERE id = $1 RETURNING *`,
      [id, verificationStatus]
    );
    return result.rows[0] ?? null;
  },

  async users(db: Db) {
    const result = await db.query(
      `SELECT p.id, p.full_name, p.email, p.phone, p.city, p.district, p.state,
              p.is_verified, p.created_at,
              coalesce(w.balance, 0) AS wallet_balance,
              (SELECT count(*)::int FROM properties pr WHERE pr.owner_id = p.id) AS listings,
              coalesce((
                SELECT string_agg(ur.role, ', ' ORDER BY ur.role)
                FROM user_roles ur
                WHERE ur.user_id = p.id
              ), '') AS roles
       FROM user_profiles p
       LEFT JOIN wallets w ON w.user_id = p.id
       ORDER BY p.created_at DESC
       LIMIT 500`
    );
    return result.rows;
  },

  async payments(db: Db) {
    const result = await db.query(
      `SELECT pay.id, pay.amount, pay.currency, pay.payment_type, pay.provider,
              pay.transaction_id, pay.status, pay.paid_at, pay.created_at,
              pr.full_name AS user_name, pr.email AS user_email, pr.phone AS user_phone,
              p.title AS property_title
       FROM payments pay
       LEFT JOIN user_profiles pr ON pr.id = pay.user_id
       LEFT JOIN properties p ON p.id = pay.property_id
       ORDER BY pay.created_at DESC
       LIMIT 500`
    );
    return result.rows;
  },
};
