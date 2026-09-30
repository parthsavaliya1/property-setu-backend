-- Shared amenity catalog and the amenities selected on each property.

CREATE TABLE IF NOT EXISTS public.amenities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT,
  icon TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT amenities_slug_unique UNIQUE (slug)
);

COMMENT ON TABLE public.amenities IS
  'Catalog of amenities such as parking, lift, and gym. Managed by admins.';

CREATE TABLE IF NOT EXISTS public.property_amenities (
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  amenity_id UUID NOT NULL REFERENCES public.amenities(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (property_id, amenity_id)
);

COMMENT ON TABLE public.property_amenities IS
  'Amenities chosen for a property.';

DROP TRIGGER IF EXISTS set_updated_at ON public.amenities;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.amenities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
