-- Roles label what a person does in the marketplace.
-- They do NOT gate property creation. Every authenticated user can list a property.

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_role_check CHECK (
    role IN (
      'buyer',
      'seller',
      'owner',
      'agent',
      'agency_admin',
      'builder',
      'developer',
      'admin',
      'super_admin'
    )
  ),
  CONSTRAINT user_roles_user_role_unique UNIQUE (user_id, role)
);

COMMENT ON TABLE public.user_roles IS
  'Optional roles for a user. A user may hold several. Property insert policies ignore this table.';
COMMENT ON COLUMN public.user_roles.role IS
  'buyer, seller, owner, agent, agency_admin, builder, developer, admin, or super_admin.';

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles (role);
