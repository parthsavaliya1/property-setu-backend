-- Profile row for every Supabase auth user.
-- Authentication stays in auth.users. This table stores marketplace profile data.

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  email TEXT,
  avatar_url TEXT,
  bio TEXT,
  city TEXT,
  district TEXT,
  state TEXT,
  pincode TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_profiles IS
  'Public marketplace profile for an auth.users account. One row is created automatically at signup.';
COMMENT ON COLUMN public.user_profiles.id IS
  'Same id as auth.users. Deleting the auth user deletes this profile.';
COMMENT ON COLUMN public.user_profiles.is_verified IS
  'Set only by an admin. Users cannot verify themselves.';
COMMENT ON COLUMN public.user_profiles.phone IS
  'Contact number. Hidden from anonymous API clients by column privileges.';

CREATE INDEX IF NOT EXISTS idx_user_profiles_city ON public.user_profiles (city);
CREATE INDEX IF NOT EXISTS idx_user_profiles_phone ON public.user_profiles (phone);

DROP TRIGGER IF EXISTS set_updated_at ON public.user_profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Idempotent: a repeated signup event or a manual re-run does not duplicate the profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, email, avatar_url, phone)
  VALUES (
    NEW.id,
    NULLIF(btrim(COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      ''
    )), ''),
    NEW.email,
    NULLIF(btrim(COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture',
      ''
    )), ''),
    NULLIF(btrim(COALESCE(NEW.phone, '')), '')
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates a user_profiles row when auth.users gains a user. Safe to run more than once.';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_profiles
  SET
    email = NEW.email,
    phone = COALESCE(NULLIF(btrim(COALESCE(NEW.phone, '')), ''), phone),
    avatar_url = COALESCE(
      avatar_url,
      NULLIF(btrim(COALESCE(
        NEW.raw_user_meta_data->>'avatar_url',
        NEW.raw_user_meta_data->>'picture',
        ''
      )), '')
    )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email, phone, raw_user_meta_data ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_updated();
