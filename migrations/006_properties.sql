-- Main listing table.
-- owner_id is required and must be the signed-in user on insert.
-- agency_id and agent_id stay optional so a person can list a home without a brokerage.

CREATE TABLE IF NOT EXISTS public.properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agency_id UUID REFERENCES public.agencies(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  category_id UUID NOT NULL REFERENCES public.property_categories(id),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  listing_type TEXT NOT NULL DEFAULT 'sale',
  property_type TEXT,
  price NUMERIC(15,2),
  price_unit TEXT,
  is_price_negotiable BOOLEAN NOT NULL DEFAULT false,
  area NUMERIC(15,2),
  area_unit TEXT NOT NULL DEFAULT 'sq_ft',
  built_up_area NUMERIC(15,2),
  carpet_area NUMERIC(15,2),
  plot_area NUMERIC(15,2),
  bedrooms INTEGER,
  bathrooms INTEGER,
  balconies INTEGER,
  floor_number INTEGER,
  total_floors INTEGER,
  parking_spaces INTEGER,
  furnishing_status TEXT,
  construction_year INTEGER,
  possession_status TEXT,
  facing TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_premium BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT properties_slug_unique UNIQUE (slug),
  CONSTRAINT properties_listing_type_check CHECK (
    listing_type IN ('sale', 'rent', 'lease', 'pg')
  ),
  CONSTRAINT properties_status_check CHECK (
    status IN (
      'draft',
      'pending_review',
      'published',
      'rejected',
      'sold',
      'rented',
      'expired',
      'archived'
    )
  ),
  CONSTRAINT properties_verification_status_check CHECK (
    verification_status IN ('pending', 'submitted', 'verified', 'rejected')
  ),
  CONSTRAINT properties_furnishing_status_check CHECK (
    furnishing_status IS NULL
    OR furnishing_status IN ('unfurnished', 'semi_furnished', 'furnished')
  ),
  CONSTRAINT properties_area_unit_check CHECK (
    area_unit IN ('sq_ft', 'sq_yd', 'sq_m', 'acre', 'hectare', 'guntha', 'bigha')
  ),
  CONSTRAINT properties_price_nonneg CHECK (price IS NULL OR price >= 0),
  CONSTRAINT properties_area_nonneg CHECK (area IS NULL OR area >= 0),
  CONSTRAINT properties_built_up_area_nonneg CHECK (built_up_area IS NULL OR built_up_area >= 0),
  CONSTRAINT properties_carpet_area_nonneg CHECK (carpet_area IS NULL OR carpet_area >= 0),
  CONSTRAINT properties_plot_area_nonneg CHECK (plot_area IS NULL OR plot_area >= 0),
  CONSTRAINT properties_bedrooms_nonneg CHECK (bedrooms IS NULL OR bedrooms >= 0),
  CONSTRAINT properties_bathrooms_nonneg CHECK (bathrooms IS NULL OR bathrooms >= 0),
  CONSTRAINT properties_balconies_nonneg CHECK (balconies IS NULL OR balconies >= 0),
  CONSTRAINT properties_floor_number_nonneg CHECK (floor_number IS NULL OR floor_number >= 0),
  CONSTRAINT properties_total_floors_nonneg CHECK (total_floors IS NULL OR total_floors >= 0),
  CONSTRAINT properties_parking_nonneg CHECK (parking_spaces IS NULL OR parking_spaces >= 0),
  CONSTRAINT properties_construction_year_check CHECK (
    construction_year IS NULL OR (construction_year >= 1800 AND construction_year <= 2200)
  )
);

COMMENT ON TABLE public.properties IS
  'Every listing. Any authenticated user may create one. Agency and agent links are optional.';
COMMENT ON COLUMN public.properties.owner_id IS
  'Required owner. On insert this must equal auth.uid(). Not a role check.';
COMMENT ON COLUMN public.properties.agency_id IS
  'Optional agency. Null when a private owner lists the property.';
COMMENT ON COLUMN public.properties.agent_id IS
  'Optional agent (auth user). Null when no agent is attached.';
COMMENT ON COLUMN public.properties.listing_type IS
  'sale, rent, lease, or pg. Defaults to sale so a minimal insert is valid.';
COMMENT ON COLUMN public.properties.slug IS
  'Unique SEO slug, generated from the title when omitted.';
COMMENT ON COLUMN public.properties.status IS
  'draft, pending_review, published, rejected, sold, rented, expired, or archived.';

CREATE OR REPLACE FUNCTION public.set_property_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  base text;
  candidate text;
  suffix integer := 0;
BEGIN
  IF NEW.slug IS NULL OR btrim(NEW.slug) = '' THEN
    base := public.slugify(NEW.title);
  ELSE
    base := public.slugify(NEW.slug);
  END IF;

  IF base IS NULL OR base = '' THEN
    base := 'property';
  END IF;

  candidate := base;
  WHILE EXISTS (
    SELECT 1
    FROM public.properties AS existing
    WHERE existing.slug = candidate
      AND existing.id IS DISTINCT FROM NEW.id
  ) LOOP
    suffix := suffix + 1;
    candidate := base || '-' || suffix::text;
  END LOOP;

  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_property_slug() IS
  'Fills a unique SEO slug such as 3-bhk-luxury-villa-kalawad-road-rajkot.';

DROP TRIGGER IF EXISTS properties_set_slug ON public.properties;
CREATE TRIGGER properties_set_slug
  BEFORE INSERT OR UPDATE OF title, slug ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.set_property_slug();

CREATE OR REPLACE FUNCTION public.touch_property_published_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    NEW.published_at := COALESCE(NEW.published_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_set_published_at ON public.properties;
CREATE TRIGGER properties_set_published_at
  BEFORE INSERT OR UPDATE OF status ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_property_published_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.properties;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
