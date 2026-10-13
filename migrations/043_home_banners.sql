-- Home-screen banners uploaded from the admin panel.
CREATE TABLE IF NOT EXISTS public.home_banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS home_banners_active_order
  ON public.home_banners (is_active, sort_order, created_at);

ALTER TABLE public.home_banners ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.home_banners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.home_banners TO authenticated;

DROP POLICY IF EXISTS home_banners_select ON public.home_banners;
CREATE POLICY home_banners_select ON public.home_banners
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS home_banners_insert ON public.home_banners;
CREATE POLICY home_banners_insert ON public.home_banners
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS home_banners_update ON public.home_banners;
CREATE POLICY home_banners_update ON public.home_banners
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS home_banners_delete ON public.home_banners;
CREATE POLICY home_banners_delete ON public.home_banners
  FOR DELETE TO authenticated
  USING (public.is_admin());
