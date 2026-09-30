-- Builder and developer projects. Optional agency link. Units can later point at listings.

CREATE TABLE IF NOT EXISTS public.property_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID REFERENCES public.agencies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  city TEXT,
  locality TEXT,
  state TEXT,
  pincode TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  total_units INTEGER,
  available_units INTEGER,
  launch_date DATE,
  completion_date DATE,
  status TEXT NOT NULL DEFAULT 'upcoming',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_projects_slug_unique UNIQUE (slug),
  CONSTRAINT property_projects_status_check CHECK (
    status IN ('upcoming', 'launched', 'under_construction', 'completed', 'sold_out', 'archived')
  ),
  CONSTRAINT property_projects_latitude_check CHECK (
    latitude IS NULL OR (latitude >= -90 AND latitude <= 90)
  ),
  CONSTRAINT property_projects_longitude_check CHECK (
    longitude IS NULL OR (longitude >= -180 AND longitude <= 180)
  ),
  CONSTRAINT property_projects_total_units_nonneg CHECK (total_units IS NULL OR total_units >= 0),
  CONSTRAINT property_projects_available_units_nonneg CHECK (
    available_units IS NULL OR available_units >= 0
  )
);

COMMENT ON TABLE public.property_projects IS
  'A builder or developer project. Listings stay on properties; units may reference them.';

CREATE INDEX IF NOT EXISTS idx_property_projects_agency_id ON public.property_projects (agency_id);
CREATE INDEX IF NOT EXISTS idx_property_projects_city ON public.property_projects (city);

DROP TRIGGER IF EXISTS set_updated_at ON public.property_projects;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
