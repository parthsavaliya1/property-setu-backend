-- Price history and rent breakdowns. The current asking price also lives on properties.price.

CREATE TABLE IF NOT EXISTS public.property_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  price NUMERIC(15,2) NOT NULL,
  price_type TEXT,
  price_per_sqft NUMERIC(15,2),
  maintenance_charge NUMERIC(15,2),
  maintenance_period TEXT,
  security_deposit NUMERIC(15,2),
  negotiable BOOLEAN NOT NULL DEFAULT false,
  valid_from DATE,
  valid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_prices_price_nonneg CHECK (price >= 0),
  CONSTRAINT property_prices_per_sqft_nonneg CHECK (price_per_sqft IS NULL OR price_per_sqft >= 0),
  CONSTRAINT property_prices_maintenance_nonneg CHECK (maintenance_charge IS NULL OR maintenance_charge >= 0),
  CONSTRAINT property_prices_deposit_nonneg CHECK (security_deposit IS NULL OR security_deposit >= 0),
  CONSTRAINT property_prices_type_check CHECK (
    price_type IS NULL OR price_type IN (
      'sale', 'monthly_rent', 'yearly_rent', 'lease', 'per_sqft', 'all_inclusive'
    )
  ),
  CONSTRAINT property_prices_period_check CHECK (
    maintenance_period IS NULL OR maintenance_period IN ('monthly', 'quarterly', 'yearly')
  ),
  CONSTRAINT property_prices_valid_range CHECK (
    valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from
  )
);

COMMENT ON TABLE public.property_prices IS
  'Detailed or historical prices, including maintenance and security deposit for rentals.';

CREATE INDEX IF NOT EXISTS idx_property_prices_property_id ON public.property_prices (property_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.property_prices;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
