-- Catalog of plans used by subscriptions, featured listings, and promotions.

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(15,2) NOT NULL,
  duration_days INTEGER NOT NULL,
  property_limit INTEGER,
  featured_property_limit INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subscription_plans_price_nonneg CHECK (price >= 0),
  CONSTRAINT subscription_plans_duration_positive CHECK (duration_days > 0),
  CONSTRAINT subscription_plans_property_limit_nonneg CHECK (
    property_limit IS NULL OR property_limit >= 0
  ),
  CONSTRAINT subscription_plans_featured_limit_nonneg CHECK (
    featured_property_limit IS NULL OR featured_property_limit >= 0
  )
);

COMMENT ON TABLE public.subscription_plans IS
  'Free, basic, premium, and agency plans. Null property_limit means unlimited.';
COMMENT ON COLUMN public.subscription_plans.property_limit IS
  'Maximum active listings. Null means no cap.';

DROP TRIGGER IF EXISTS set_updated_at ON public.subscription_plans;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
