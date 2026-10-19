CREATE TABLE public.otp_sessions (
  session_id text PRIMARY KEY,
  phone_hash text NOT NULL,
  otp_hash text,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);
ALTER TABLE public.otp_sessions ENABLE ROW LEVEL SECURITY;
