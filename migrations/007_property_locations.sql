-- One location row per property. location_point is a PostGIS geography for radius search.

CREATE TABLE IF NOT EXISTS public.property_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL UNIQUE REFERENCES public.properties(id) ON DELETE CASCADE,
  address TEXT,
  address_line_2 TEXT,
  locality TEXT,
  area TEXT,
  landmark TEXT,
  village TEXT,
  taluka TEXT,
  city TEXT,
  district TEXT,
  state TEXT,
  country TEXT NOT NULL DEFAULT 'India',
  pincode TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  location_point geography(Point, 4326),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_locations_latitude_check CHECK (
    latitude IS NULL OR (latitude >= -90 AND latitude <= 90)
  ),
  CONSTRAINT property_locations_longitude_check CHECK (
    longitude IS NULL OR (longitude >= -180 AND longitude <= 180)
  )
);

COMMENT ON TABLE public.property_locations IS
  'Address and map point for a property. Supports near me, 1/5/10 km, and map search.';
COMMENT ON COLUMN public.property_locations.area IS
  'Neighbourhood or area name, such as Kalawad Road. Numeric size lives on properties.area.';
COMMENT ON COLUMN public.property_locations.location_point IS
  'WGS84 geography point kept in sync with latitude and longitude.';

CREATE OR REPLACE FUNCTION public.sync_property_location_point()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location_point := ST_SetSRID(
      ST_MakePoint(NEW.longitude::double precision, NEW.latitude::double precision),
      4326
    )::geography;
  ELSE
    NEW.location_point := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_locations_sync_point ON public.property_locations;
CREATE TRIGGER property_locations_sync_point
  BEFORE INSERT OR UPDATE OF latitude, longitude ON public.property_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_property_location_point();

DROP TRIGGER IF EXISTS set_updated_at ON public.property_locations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Returns property ids inside a radius. Callers still pass through RLS on property_locations.
CREATE OR REPLACE FUNCTION public.properties_within_radius(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision
)
RETURNS TABLE (
  property_id uuid,
  distance_meters double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    pl.property_id,
    ST_Distance(
      pl.location_point,
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
    ) AS distance_meters
  FROM public.property_locations AS pl
  WHERE pl.location_point IS NOT NULL
    AND p_radius_km > 0
    AND ST_DWithin(
      pl.location_point,
      ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
      p_radius_km * 1000
    );
$$;

COMMENT ON FUNCTION public.properties_within_radius(double precision, double precision, double precision) IS
  'Properties within radius_km of a latitude/longitude. Use 1, 5, or 10 for the map filters.';
