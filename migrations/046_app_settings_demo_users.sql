-- Admin-controlled listing prices, premium offer, and demo logins.
-- Demo phones never receive an SMS. The fixed OTP is checked on the server.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (key, value) VALUES
  ('standard_price', '20'),
  ('premium_price', '30'),
  ('premium_offer_percent', '0'),
  ('yearly_discount_percent', '15')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.demo_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  otp TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT 'Demo user',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS demo_users_phone_unique ON public.demo_users (phone);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_users ENABLE ROW LEVEL SECURITY;
