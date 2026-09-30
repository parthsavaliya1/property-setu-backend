import type { Db } from "../db.js";

export type ProfileUpdate = {
  full_name?: string;
  phone?: string;
  avatar_url?: string | null;
  bio?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
};

export const UserModel = {
  async me(db: Db) {
    const profile = await db.query(`SELECT * FROM user_profiles WHERE id = auth.uid()`);
    const roles = await db.query(`SELECT role FROM user_roles WHERE user_id = auth.uid() ORDER BY role`);
    const flags = await db.query(`SELECT public.is_admin() AS is_admin, public.is_super_admin() AS is_super_admin`);
    return {
      profile: profile.rows[0] ?? null,
      roles: roles.rows.map((row) => row.role as string),
      is_admin: flags.rows[0]?.is_admin === true,
      is_super_admin: flags.rows[0]?.is_super_admin === true,
    };
  },

  async updateProfile(db: Db, input: ProfileUpdate) {
    const result = await db.query(
      `UPDATE user_profiles SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        avatar_url = COALESCE($3, avatar_url),
        bio = COALESCE($4, bio),
        city = COALESCE($5, city),
        district = COALESCE($6, district),
        state = COALESCE($7, state),
        pincode = COALESCE($8, pincode)
      WHERE id = auth.uid()
      RETURNING *`,
      [
        input.full_name ?? null,
        input.phone ?? null,
        input.avatar_url ?? null,
        input.bio ?? null,
        input.city ?? null,
        input.district ?? null,
        input.state ?? null,
        input.pincode ?? null,
      ]
    );
    return result.rows[0] ?? null;
  },

  async isAdmin(db: Db) {
    const result = await db.query(`SELECT public.is_admin() AS is_admin`);
    return result.rows[0]?.is_admin === true;
  },
};
