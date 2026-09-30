-- Verification cases for an owner, documents, location, property, agency, or agent.

CREATE TABLE IF NOT EXISTS public.property_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  verification_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  submitted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_verifications_type_check CHECK (
    verification_type IN ('owner', 'documents', 'location', 'property', 'agency', 'agent')
  ),
  CONSTRAINT property_verifications_status_check CHECK (
    status IN ('pending', 'submitted', 'verified', 'rejected')
  )
);

COMMENT ON TABLE public.property_verifications IS
  'Moderation records. Owners submit them. Admins verify or reject them.';

CREATE INDEX IF NOT EXISTS idx_property_verifications_property_id
  ON public.property_verifications (property_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.property_verifications;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
