-- Properties a user has saved.

CREATE TABLE IF NOT EXISTS public.property_favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, property_id)
);

COMMENT ON TABLE public.property_favorites IS
  'Saved properties. A user can read and change only their own rows.';
