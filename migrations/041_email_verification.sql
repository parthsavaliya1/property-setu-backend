-- Email/password accounts stay signed out until they open the Resend link.
-- Accounts that already exist keep working.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

UPDATE public.accounts
SET email_verified = true,
    email_verified_at = COALESCE(email_verified_at, created_at, now())
WHERE email_verified = false;

CREATE TABLE IF NOT EXISTS public.email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verifications_account_id
  ON public.email_verifications (account_id, created_at DESC);

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
