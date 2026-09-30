-- Gallery, cover, and floor-plan photos for a listing.

CREATE TABLE IF NOT EXISTS public.property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  image_type TEXT NOT NULL DEFAULT 'gallery',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_cover BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_images_type_check CHECK (
    image_type IN (
      'cover',
      'gallery',
      'exterior',
      'interior',
      'bedroom',
      'kitchen',
      'bathroom',
      'balcony',
      'garden',
      'parking',
      'floor_plan',
      'other'
    )
  )
);

COMMENT ON TABLE public.property_images IS
  'Photos for a property. One row may be marked as the cover.';
COMMENT ON COLUMN public.property_images.is_cover IS
  'True for the image shown on cards and the top of the details screen.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_property_images_one_cover
  ON public.property_images (property_id)
  WHERE is_cover;

CREATE OR REPLACE FUNCTION public.ensure_single_cover_image()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_cover THEN
    UPDATE public.property_images
    SET is_cover = false
    WHERE property_id = NEW.property_id
      AND id IS DISTINCT FROM NEW.id
      AND is_cover;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_images_single_cover ON public.property_images;
CREATE TRIGGER property_images_single_cover
  BEFORE INSERT OR UPDATE OF is_cover ON public.property_images
  FOR EACH ROW
  WHEN (NEW.is_cover)
  EXECUTE FUNCTION public.ensure_single_cover_image();
