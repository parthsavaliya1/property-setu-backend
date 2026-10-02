-- Paid listings are activated by the API database role, not by the signed-in user.
-- App users still cannot mark a listing premium or skip review themselves.
-- A published listing is active immediately. There is no verification step.

ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_verification_status_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_verification_status_check CHECK (
  verification_status IN ('pending', 'submitted', 'verified', 'rejected', 'active')
);

CREATE OR REPLACE FUNCTION public.protect_property_moderation_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'authenticator') OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_featured := false;
    NEW.is_premium := false;
    IF NEW.verification_status IN ('verified', 'active') THEN
      NEW.verification_status := 'pending';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'You cannot transfer this property';
  END IF;

  NEW.is_featured := OLD.is_featured;
  NEW.is_premium := OLD.is_premium;
  IF NEW.verification_status IN ('verified', 'active')
     AND OLD.verification_status IS DISTINCT FROM NEW.verification_status
     AND OLD.verification_status NOT IN ('verified', 'active') THEN
    NEW.verification_status := OLD.verification_status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'authenticator') OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.paid_at := NULL;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only an admin can change a payment';
END;
$$;

UPDATE public.properties AS p
SET is_premium = true
WHERE p.is_premium = false
  AND (
    EXISTS (
      SELECT 1
      FROM public.wallet_transactions AS t
      WHERE t.property_id = p.id
        AND t.direction = 'debit'
        AND t.amount IN (30, 306)
    )
    OR EXISTS (
      SELECT 1
      FROM public.payments AS pay
      WHERE pay.property_id = p.id
        AND pay.status = 'paid'
        AND pay.payment_type = 'property_promotion'
    )
  );

UPDATE public.properties
SET verification_status = 'active'
WHERE status = 'published'
  AND verification_status IS DISTINCT FROM 'active';

INSERT INTO public.property_features (property_id, feature_key, feature_value)
SELECT p.id,
       'listing_term',
       CASE
         WHEN p.expires_at IS NOT NULL
           AND p.expires_at > COALESCE(p.published_at, p.created_at) + interval '300 days'
         THEN 'year'
         ELSE 'month'
       END
FROM public.properties AS p
WHERE p.status IN ('published', 'expired')
ON CONFLICT (property_id, feature_key) DO NOTHING;
