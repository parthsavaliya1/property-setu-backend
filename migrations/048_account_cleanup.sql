-- Ownership records also cover uploads that were never attached to a listing.
CREATE TABLE public.user_uploads (
  remote_key text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_uploads ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.storage_deletion_jobs (
  remote_key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  requires_review boolean NOT NULL DEFAULT false,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.storage_deletion_jobs ENABLE ROW LEVEL SECURITY;
