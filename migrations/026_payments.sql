-- Payments for subscriptions, featured listings, promotions, and ads.

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  amount NUMERIC(15,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_type TEXT,
  provider TEXT,
  transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payments_amount_nonneg CHECK (amount >= 0),
  CONSTRAINT payments_type_check CHECK (
    payment_type IS NULL OR payment_type IN (
      'subscription',
      'featured_listing',
      'property_promotion',
      'advertisement',
      'other'
    )
  ),
  CONSTRAINT payments_status_check CHECK (
    status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')
  )
);

COMMENT ON TABLE public.payments IS
  'Money events. A user may create a pending payment. Only an admin can mark it paid.';
COMMENT ON COLUMN public.payments.transaction_id IS
  'Provider reference such as a Razorpay payment id. Unique when present.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_id
  ON public.payments (transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_user_id ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_property_id ON public.payments (property_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON public.payments (subscription_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.payments;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
