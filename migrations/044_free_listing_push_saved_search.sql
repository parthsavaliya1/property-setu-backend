-- One free 15-day listing per account, phone push tokens, and extra saved-search filters.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS free_listing_used BOOLEAN NOT NULL DEFAULT false;

UPDATE public.accounts AS account
SET free_listing_used = true
WHERE account.free_listing_used = false
  AND EXISTS (
    SELECT 1 FROM public.properties AS property
    WHERE property.owner_id = account.id
      AND property.published_at IS NOT NULL
  );

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT push_tokens_token_unique UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON public.push_tokens (user_id);

ALTER TABLE public.saved_searches
  ADD COLUMN IF NOT EXISTS q TEXT,
  ADD COLUMN IF NOT EXISTS category_slug TEXT;
