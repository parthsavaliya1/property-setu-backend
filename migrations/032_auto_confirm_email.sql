-- Sign-up does not require an email confirmation link.
-- The row is marked confirmed as it is written, so Auth can return a session immediately.

CREATE OR REPLACE FUNCTION public.confirm_user_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at := now();
  END IF;
  NEW.confirmation_token := '';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS confirm_user_email ON auth.users;

CREATE TRIGGER confirm_user_email
  BEFORE INSERT OR UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.confirm_user_email();

UPDATE auth.users
SET email_confirmed_at = now()
WHERE email_confirmed_at IS NULL;
