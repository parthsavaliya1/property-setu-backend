-- User reports of fake, wrong, or inappropriate listings. Admins review them.

CREATE TABLE IF NOT EXISTS public.property_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  reported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_reports_reason_check CHECK (
    reason IN (
      'fake_property',
      'wrong_price',
      'wrong_location',
      'duplicate',
      'already_sold',
      'fraud',
      'inappropriate',
      'other'
    )
  ),
  CONSTRAINT property_reports_status_check CHECK (
    status IN ('pending', 'reviewing', 'resolved', 'dismissed')
  )
);

COMMENT ON TABLE public.property_reports IS
  'Abuse reports. Any signed-in user can file one. Only admins can review or resolve it.';

CREATE INDEX IF NOT EXISTS idx_property_reports_property_id ON public.property_reports (property_id);
CREATE INDEX IF NOT EXISTS idx_property_reports_reported_by ON public.property_reports (reported_by);
CREATE INDEX IF NOT EXISTS idx_property_reports_status ON public.property_reports (status);

DROP TRIGGER IF EXISTS set_updated_at ON public.property_reports;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
