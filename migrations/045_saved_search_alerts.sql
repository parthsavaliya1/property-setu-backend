-- Listings already announced for a saved search. A later edit does not alert again.

CREATE TABLE IF NOT EXISTS public.saved_search_hits (
  saved_search_id UUID NOT NULL REFERENCES public.saved_searches(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (saved_search_id, property_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_search_hits_property
  ON public.saved_search_hits (property_id);
