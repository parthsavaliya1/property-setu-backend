-- Paid placement for a listing: featured, top of search, homepage, premium, or boost.

CREATE TABLE IF NOT EXISTS public.property_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  promotion_type TEXT NOT NULL,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  amount NUMERIC(15,2),
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_promotions_type_check CHECK (
    promotion_type IN ('featured', 'top_search', 'homepage', 'premium', 'boost')
  ),
  CONSTRAINT property_promotions_status_check CHECK (
    status IN ('pending', 'active', 'expired', 'cancelled')
  ),
  CONSTRAINT property_promotions_amount_nonneg CHECK (amount IS NULL OR amount >= 0),
  CONSTRAINT property_promotions_window_check CHECK (
    end_at IS NULL OR start_at IS NULL OR end_at >= start_at
  )
);

COMMENT ON TABLE public.property_promotions IS
  'Time-boxed promotion for a listing. Owners request it. Admins or a paid webhook activate it.';

CREATE INDEX IF NOT EXISTS idx_property_promotions_property_id ON public.property_promotions (property_id);
CREATE INDEX IF NOT EXISTS idx_property_promotions_payment_id ON public.property_promotions (payment_id);
CREATE INDEX IF NOT EXISTS idx_property_promotions_active
  ON public.property_promotions (status, start_at, end_at);

DROP TRIGGER IF EXISTS set_updated_at ON public.property_promotions;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_promotions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
