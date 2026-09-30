-- Individual flats or plots inside a project. property_id is optional until a unit is listed.

CREATE TABLE IF NOT EXISTS public.project_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.property_projects(id) ON DELETE CASCADE,
  property_id UUID REFERENCES public.properties(id) ON DELETE SET NULL,
  unit_number TEXT,
  tower TEXT,
  floor INTEGER,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_units_status_check CHECK (
    status IN ('available', 'blocked', 'booked', 'sold')
  ),
  CONSTRAINT project_units_floor_nonneg CHECK (floor IS NULL OR floor >= 0)
);

COMMENT ON TABLE public.project_units IS
  'A unit inside a project. property_id links the unit to a marketplace listing when one exists.';
COMMENT ON COLUMN public.project_units.property_id IS
  'Optional listing created for this unit. Deleting the listing keeps the unit.';

CREATE INDEX IF NOT EXISTS idx_project_units_project_id ON public.project_units (project_id);
CREATE INDEX IF NOT EXISTS idx_project_units_property_id ON public.project_units (property_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.project_units;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.project_units
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
