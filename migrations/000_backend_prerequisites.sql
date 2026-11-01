-- Native PostgreSQL prerequisites for the historical Supabase RLS policies.
-- Never replace provider-managed roles or auth.uid() on Supabase.
DO $roles$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
      -- The backend switches to these roles for each request.
      EXECUTE format('GRANT %I TO %I', role_name, current_user);
    END IF;
  END LOOP;
END $roles$;

CREATE SCHEMA IF NOT EXISTS auth;
DO $uid$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL THEN
    EXECUTE $function$
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $body$
        SELECT coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        )::uuid
      $body$
    $function$;
  END IF;
END $uid$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

-- Must precede the profile and listing foreign keys. Migration 033 still
-- imports legacy Supabase identities and moves existing foreign keys.
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_set BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
