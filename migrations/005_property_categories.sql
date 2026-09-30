-- Parent/child categories. Application code should read this tree instead of hardcoding types.

CREATE TABLE IF NOT EXISTS public.property_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES public.property_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_categories_slug_unique UNIQUE (slug),
  CONSTRAINT property_categories_not_self CHECK (parent_id IS DISTINCT FROM id)
);

COMMENT ON TABLE public.property_categories IS
  'Residential, land, commercial, and other types. Children point at a parent category.';
COMMENT ON COLUMN public.property_categories.parent_id IS
  'Null for a top-level group such as Residential or Land.';

CREATE INDEX IF NOT EXISTS idx_property_categories_parent ON public.property_categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_property_categories_active ON public.property_categories (is_active, sort_order);

DROP TRIGGER IF EXISTS set_updated_at ON public.property_categories;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
