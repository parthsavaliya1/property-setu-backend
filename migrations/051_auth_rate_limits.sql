CREATE TABLE public.auth_rate_limits (
  bucket_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1,
  resets_at timestamptz NOT NULL
);
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
