-- Analytics hits for a listing. user_id is null for anonymous views.

CREATE TABLE IF NOT EXISTS public.property_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address INET,
  device_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_views_device_type_check CHECK (
    device_type IS NULL OR device_type IN ('web', 'ios', 'android', 'other')
  )
);

COMMENT ON TABLE public.property_views IS
  'Each time a listing is opened. Used later for owner and admin analytics.';
COMMENT ON COLUMN public.property_views.user_id IS
  'Viewer when signed in. Null for a guest. Cleared if the account is deleted.';
