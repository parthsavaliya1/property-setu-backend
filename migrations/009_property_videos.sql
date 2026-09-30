-- Walkthrough and other videos attached to a listing.

CREATE TABLE IF NOT EXISTS public.property_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  duration INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_videos_duration_nonneg CHECK (duration IS NULL OR duration >= 0)
);

COMMENT ON TABLE public.property_videos IS
  'Video files or hosted URLs for a property. duration is stored in seconds.';
COMMENT ON COLUMN public.property_videos.duration IS 'Playback length in seconds.';
