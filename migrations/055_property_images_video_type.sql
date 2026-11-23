-- Listing clients store photos and videos together in property_images.
-- Preserve every existing photo type while admitting the video discriminator.
ALTER TABLE public.property_images
  DROP CONSTRAINT IF EXISTS property_images_type_check;
ALTER TABLE public.property_images
  ADD CONSTRAINT property_images_type_check CHECK (
    image_type IN (
      'cover', 'gallery', 'exterior', 'interior', 'bedroom', 'kitchen',
      'bathroom', 'balcony', 'garden', 'parking', 'floor_plan', 'other', 'video'
    )
  );
COMMENT ON TABLE public.property_images IS
  'Property photos and videos. Videos use image_type=video; photos may be marked as the cover.';
