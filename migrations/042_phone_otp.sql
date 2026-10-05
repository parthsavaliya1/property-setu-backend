-- Phone OTP accounts. Email stays optional so a mobile number is enough to sign in.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE public.accounts
  ALTER COLUMN email DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_phone_unique
  ON public.accounts (phone)
  WHERE phone IS NOT NULL;
