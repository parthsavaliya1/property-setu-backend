-- Flexible key/value facts that differ by property type
-- (facing, road width, soil type, irrigation) without a schema change per type.

CREATE TABLE IF NOT EXISTS public.property_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  feature_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_features_key_unique UNIQUE (property_id, feature_key)
);

COMMENT ON TABLE public.property_features IS
  'Type-specific facts. Examples: facing=East, road_width=30 ft, soil_type=Black Soil.';
COMMENT ON COLUMN public.property_features.feature_key IS
  'Stable key such as facing, corner_plot, water_source, or irrigation.';

CREATE INDEX IF NOT EXISTS idx_property_features_key ON public.property_features (feature_key);

DROP TRIGGER IF EXISTS set_updated_at ON public.property_features;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_features
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
