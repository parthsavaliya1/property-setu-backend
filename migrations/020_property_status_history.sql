-- Audit trail for listing status changes (draft, published, sold, archived, and so on).

CREATE TABLE IF NOT EXISTS public.property_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.property_status_history IS
  'Written automatically when properties.status changes.';

CREATE INDEX IF NOT EXISTS idx_property_status_history_property_id
  ON public.property_status_history (property_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_property_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.property_status_history (
      property_id,
      old_status,
      new_status,
      changed_by
    )
    VALUES (
      NEW.id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
      NEW.status,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_log_status ON public.properties;
CREATE TRIGGER properties_log_status
  AFTER INSERT OR UPDATE OF status ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.log_property_status_change();
