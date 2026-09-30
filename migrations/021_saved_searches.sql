-- Filters a user wants to run again, and later use for match notifications.

CREATE TABLE IF NOT EXISTS public.saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT,
  locality TEXT,
  category_id UUID REFERENCES public.property_categories(id) ON DELETE SET NULL,
  listing_type TEXT,
  min_price NUMERIC(15,2),
  max_price NUMERIC(15,2),
  min_area NUMERIC(15,2),
  max_area NUMERIC(15,2),
  bedrooms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT saved_searches_listing_type_check CHECK (
    listing_type IS NULL OR listing_type IN ('sale', 'rent', 'lease', 'pg')
  ),
  CONSTRAINT saved_searches_min_price_nonneg CHECK (min_price IS NULL OR min_price >= 0),
  CONSTRAINT saved_searches_max_price_nonneg CHECK (max_price IS NULL OR max_price >= 0),
  CONSTRAINT saved_searches_min_area_nonneg CHECK (min_area IS NULL OR min_area >= 0),
  CONSTRAINT saved_searches_max_area_nonneg CHECK (max_area IS NULL OR max_area >= 0),
  CONSTRAINT saved_searches_bedrooms_nonneg CHECK (bedrooms IS NULL OR bedrooms >= 0),
  CONSTRAINT saved_searches_price_range CHECK (
    max_price IS NULL OR min_price IS NULL OR max_price >= min_price
  )
);

COMMENT ON TABLE public.saved_searches IS
  'A named search a user can reopen. Ready for later new-match notifications.';

CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id ON public.saved_searches (user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_category_id ON public.saved_searches (category_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.saved_searches;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.saved_searches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
