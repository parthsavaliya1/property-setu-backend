ALTER TABLE public.accounts ADD COLUMN suspended_at timestamptz;
CREATE FUNCTION public.account_suspended_at(account_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT suspended_at FROM accounts WHERE id = account_id AND public.is_admin();
$$;
REVOKE ALL ON FUNCTION public.account_suspended_at(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_suspended_at(uuid) TO authenticated;
CREATE FUNCTION public.account_active(account_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM accounts WHERE id = account_id AND suspended_at IS NULL);
$$;
REVOKE ALL ON FUNCTION public.account_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_active(uuid) TO anon, authenticated;
