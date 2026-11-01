import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { citext } from '@electric-sql/pglite/contrib/citext';

// PGlite has no PostGIS binary. Spatial stubs allow the complete migration
// history to be checked for SQL/dependency errors; spatial behavior is not tested.
test('entire migration history installs without Supabase and preserves account foreign keys', async () => {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, citext } });
  try {
    await db.exec(`
      CREATE DOMAIN geography AS text;
      CREATE FUNCTION st_makepoint(float8, float8) RETURNS text LANGUAGE sql AS $$ SELECT 'point'::text $$;
      CREATE FUNCTION st_setsrid(text, integer) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
      CREATE FUNCTION st_distance(geography, geography) RETURNS float8 LANGUAGE sql AS $$ SELECT 0::float8 $$;
      CREATE FUNCTION st_dwithin(geography, geography, float8) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    `);
    const directory = new URL('../migrations/', import.meta.url);
    for (const file of (await fs.readdir(directory)).filter(f => f.endsWith('.sql')).sort()) {
      let sql = await fs.readFile(new URL(file, directory), 'utf8');
      sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS postgis;/g, '')
        .replace(/COMMENT ON EXTENSION postgis IS '[^']*';/g, '')
        .replace(/geography\(Point, 4326\)/g, 'geography')
        .replace(/USING gist \(location_point\)/gi, '(location_point)');
      try { await db.exec(sql); } catch (error) { throw new Error(`Migration failed: ${file}`, { cause: error }); }
    }
    assert.equal((await db.query<{ users: string | null }>("SELECT to_regclass('auth.users') AS users")).rows[0].users, null);
    const id = '00000000-0000-4000-8000-000000000001';
    await db.query("INSERT INTO accounts (id,email,password_hash) VALUES ($1,'test@example.com','unused')", [id]);
    await db.query('INSERT INTO user_profiles (id) VALUES ($1)', [id]);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id]);
    assert.equal((await db.query<{ id: string }>('SELECT auth.uid() AS id')).rows[0].id, id);
    await db.query('DELETE FROM accounts WHERE id=$1', [id]);
    assert.equal((await db.query('SELECT * FROM user_profiles')).rows.length, 0);
    // Bootstrap is safe on retry and preserves an existing provider function.
    await db.exec("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-4000-8000-000000000002'::uuid $$");
    await db.exec(await fs.readFile(new URL('000_backend_prerequisites.sql', directory), 'utf8'));
    assert.equal((await db.query<{ id: string }>('SELECT auth.uid() AS id')).rows[0].id, '00000000-0000-4000-8000-000000000002');
  } finally { await db.close(); }
});
