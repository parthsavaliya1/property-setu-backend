-- One wallet per account. The API credits it after Razorpay and debits it when a listing is published.

CREATE TABLE IF NOT EXISTS public.wallets (
  user_id UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallets_balance_nonneg CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL,
  direction TEXT NOT NULL,
  reason TEXT NOT NULL,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  transaction_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wallet_transactions_amount_positive CHECK (amount > 0),
  CONSTRAINT wallet_transactions_direction_check CHECK (direction IN ('credit', 'debit'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_provider_id
  ON public.wallet_transactions (transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user
  ON public.wallet_transactions (user_id, created_at DESC);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wallets_select ON public.wallets;
CREATE POLICY wallets_select ON public.wallets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS wallet_transactions_select ON public.wallet_transactions;
CREATE POLICY wallet_transactions_select ON public.wallet_transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
