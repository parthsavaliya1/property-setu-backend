-- Agencies and their staff. A property can exist with no agency and no agent.

CREATE TABLE IF NOT EXISTS public.agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  logo_url TEXT,
  cover_image_url TEXT,
  description TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  address TEXT,
  city TEXT,
  district TEXT,
  state TEXT,
  pincode TEXT,
  gst_number TEXT,
  rera_number TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agencies_slug_unique UNIQUE (slug),
  CONSTRAINT agencies_verification_status_check CHECK (
    verification_status IN ('pending', 'submitted', 'verified', 'rejected')
  )
);

COMMENT ON TABLE public.agencies IS
  'Brokerage, builder, or developer company. Optional on every property.';
COMMENT ON COLUMN public.agencies.created_by IS
  'User who registered the agency. Clearing the user keeps the agency.';
COMMENT ON COLUMN public.agencies.rera_number IS
  'RERA registration number used during agency verification.';

CREATE TABLE IF NOT EXISTS public.agency_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'agent',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agency_members_role_check CHECK (
    role IN ('owner', 'admin', 'manager', 'agent', 'staff')
  ),
  CONSTRAINT agency_members_unique UNIQUE (agency_id, user_id)
);

COMMENT ON TABLE public.agency_members IS
  'Links auth users to an agency. Membership role controls agency management, not property creation.';
COMMENT ON COLUMN public.agency_members.role IS
  'owner, admin, manager, agent, or staff.';

CREATE INDEX IF NOT EXISTS idx_agencies_city ON public.agencies (city);
CREATE INDEX IF NOT EXISTS idx_agencies_created_by ON public.agencies (created_by);
CREATE INDEX IF NOT EXISTS idx_agency_members_user_id ON public.agency_members (user_id);
CREATE INDEX IF NOT EXISTS idx_agency_members_agency_id ON public.agency_members (agency_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.agencies;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.agencies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON public.agency_members;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.agency_members
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- The creator becomes the agency owner even before membership RLS would allow the insert.
CREATE OR REPLACE FUNCTION public.add_agency_creator_as_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.agency_members (agency_id, user_id, role)
    VALUES (NEW.id, NEW.created_by, 'owner')
    ON CONFLICT (agency_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agencies_add_owner ON public.agencies;
CREATE TRIGGER agencies_add_owner
  AFTER INSERT ON public.agencies
  FOR EACH ROW
  EXECUTE FUNCTION public.add_agency_creator_as_owner();
