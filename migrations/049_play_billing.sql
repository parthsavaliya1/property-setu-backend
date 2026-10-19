-- A token can grant wallet credits once, regardless of client retries.
CREATE TABLE public.play_purchases (
  token_hash text PRIMARY KEY,
  user_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  product_id text NOT NULL,
  credits numeric(15,2) NOT NULL CHECK (credits > 0),
  purchase_token text,
  consumed boolean NOT NULL DEFAULT false,
  voided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.play_purchases ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.play_billing_sync (
  id integer PRIMARY KEY CHECK (id = 1),
  next_page_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.play_billing_sync ENABLE ROW LEVEL SECURITY;
