-- Shared extensions and reusable trigger helpers.
-- PostGIS powers near-me, radius, and map search.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS postgis;

COMMENT ON EXTENSION postgis IS 'Geography search for property locations (near me, radius, map).';

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_updated_at_column() IS
  'Sets updated_at to the current timestamp before a row is updated.';

CREATE OR REPLACE FUNCTION public.slugify(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(BOTH '-' FROM regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

COMMENT ON FUNCTION public.slugify(text) IS
  'Builds a lowercase URL slug. Non-alphanumeric characters become hyphens.';
