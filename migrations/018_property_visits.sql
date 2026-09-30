-- Site visits requested by a buyer and handled by the owner or an agent.

CREATE TABLE IF NOT EXISTS public.property_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  buyer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'requested',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT property_visits_status_check CHECK (
    status IN ('requested', 'confirmed', 'completed', 'cancelled', 'rescheduled')
  )
);

COMMENT ON TABLE public.property_visits IS
  'Scheduled property visits. Status moves from requested to confirmed, completed, cancelled, or rescheduled.';

CREATE INDEX IF NOT EXISTS idx_property_visits_property_id ON public.property_visits (property_id);
CREATE INDEX IF NOT EXISTS idx_property_visits_buyer_id ON public.property_visits (buyer_id);
CREATE INDEX IF NOT EXISTS idx_property_visits_scheduled_at ON public.property_visits (scheduled_at);

DROP TRIGGER IF EXISTS set_updated_at ON public.property_visits;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.property_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
