-- App accounts. Login checks this table. It does not call Supabase Auth.
CREATE TABLE IF NOT EXISTS public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_set BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_lower ON public.accounts (lower(email));

ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS password_set BOOLEAN NOT NULL DEFAULT false;

-- Keep existing profile rows valid after the foreign keys move off auth.users.
INSERT INTO public.accounts (id, email, password_hash)
SELECT id, COALESCE(NULLIF(btrim(email), ''), id::text || '@users.local'), crypt(gen_random_uuid()::text, gen_salt('bf'))
FROM auth.users
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  constraint_row RECORD;
  definition TEXT;
BEGIN
  FOR constraint_row IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, con.conname AS constraint_name, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.contype = 'f'
      AND n.nspname = 'public'
      AND con.confrelid = 'auth.users'::regclass
  LOOP
    definition := replace(constraint_row.definition, 'REFERENCES auth.users', 'REFERENCES public.accounts');
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', constraint_row.schema_name, constraint_row.table_name, constraint_row.constraint_name);
    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I %s', constraint_row.schema_name, constraint_row.table_name, constraint_row.constraint_name, definition);
  END LOOP;
END $$;
