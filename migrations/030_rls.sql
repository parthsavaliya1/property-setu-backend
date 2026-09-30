-- Row Level Security.
-- Property creation is allowed for every authenticated user.
-- The only insert rule is owner_id = auth.uid(). Roles are not consulted.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin', 'super_admin')
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'True when the current user has the admin or super_admin role. Enforced in the database, not the client.';

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'super_admin'
  );
$$;

COMMENT ON FUNCTION public.is_super_admin() IS
  'True only for super_admin. Required to grant or revoke roles.';

CREATE OR REPLACE FUNCTION public.owns_property(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.properties AS p
    WHERE p.id = p_property_id
      AND p.owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_property(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.properties AS p
    WHERE p.id = p_property_id
      AND (
        p.status = 'published'
        OR p.owner_id = auth.uid()
        OR public.is_admin()
        OR (
          p.agency_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.agency_members AS am
            WHERE am.agency_id = p.agency_id
              AND am.user_id = auth.uid()
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.agency_role(p_agency_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT am.role
  FROM public.agency_members AS am
  WHERE am.agency_id = p_agency_id
    AND am.user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_agency(p_agency_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR public.agency_role(p_agency_id) IN ('owner', 'admin', 'manager');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_agency_member(p_agency_id uuid, p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_super_admin() THEN true
    WHEN public.agency_role(p_agency_id) = 'owner' THEN true
    WHEN public.agency_role(p_agency_id) = 'admin' THEN p_role IS DISTINCT FROM 'owner'
    WHEN public.agency_role(p_agency_id) = 'manager' THEN p_role IN ('agent', 'staff')
    WHEN public.is_admin() THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.property_projects AS pp
      WHERE pp.id = p_project_id
        AND pp.agency_id IS NOT NULL
        AND public.can_manage_agency(pp.agency_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.property_favorite_count(p_property_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
  FROM public.property_favorites AS f
  WHERE f.property_id = p_property_id
    AND public.can_view_property(p_property_id);
$$;

-- ---------------------------------------------------------------------------
-- Keep moderation columns under admin control
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT public.is_admin() THEN
    NEW.is_verified := OLD.is_verified;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_protect_verification ON public.user_profiles;
CREATE TRIGGER user_profiles_protect_verification
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_verification();

CREATE OR REPLACE FUNCTION public.protect_property_moderation_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_featured := false;
    NEW.is_premium := false;
    IF NEW.verification_status = 'verified' THEN
      NEW.verification_status := 'pending';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'You cannot transfer this property';
  END IF;

  NEW.is_featured := OLD.is_featured;
  NEW.is_premium := OLD.is_premium;
  IF NEW.verification_status = 'verified' AND OLD.verification_status IS DISTINCT FROM 'verified' THEN
    NEW.verification_status := OLD.verification_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_protect_moderation ON public.properties;
CREATE TRIGGER properties_protect_moderation
  BEFORE INSERT OR UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_property_moderation_fields();

CREATE OR REPLACE FUNCTION public.protect_agency_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.is_verified := false;
    IF NEW.verification_status = 'verified' THEN
      NEW.verification_status := 'pending';
    END IF;
  ELSE
    NEW.is_verified := OLD.is_verified;
    IF NEW.verification_status = 'verified' AND OLD.verification_status IS DISTINCT FROM 'verified' THEN
      NEW.verification_status := OLD.verification_status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agencies_protect_verification ON public.agencies;
CREATE TRIGGER agencies_protect_verification
  BEFORE INSERT OR UPDATE ON public.agencies
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_agency_verification();

CREATE OR REPLACE FUNCTION public.protect_document_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.verification_status := 'pending';
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
  ELSE
    NEW.verification_status := OLD.verification_status;
    NEW.verified_by := OLD.verified_by;
    NEW.verified_at := OLD.verified_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_documents_protect_verification ON public.property_documents;
CREATE TRIGGER property_documents_protect_verification
  BEFORE INSERT OR UPDATE ON public.property_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_document_verification();

CREATE OR REPLACE FUNCTION public.protect_verification_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.verified_by := NULL;
    NEW.verified_at := NULL;
  ELSE
    NEW.status := OLD.status;
    NEW.verified_by := OLD.verified_by;
    NEW.verified_at := OLD.verified_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_verifications_protect_review ON public.property_verifications;
CREATE TRIGGER property_verifications_protect_review
  BEFORE INSERT OR UPDATE ON public.property_verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_verification_review();

CREATE OR REPLACE FUNCTION public.protect_report_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Only an admin can review a report';
END;
$$;

DROP TRIGGER IF EXISTS property_reports_protect_review ON public.property_reports;
CREATE TRIGGER property_reports_protect_review
  BEFORE INSERT OR UPDATE ON public.property_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_report_review();

CREATE OR REPLACE FUNCTION public.protect_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
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

DROP TRIGGER IF EXISTS payments_protect_status ON public.payments;
CREATE TRIGGER payments_protect_status
  BEFORE INSERT OR UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_payment_status();

CREATE OR REPLACE FUNCTION public.protect_promotion_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
    NEW.status := OLD.status;
  END IF;
  NEW.amount := OLD.amount;
  NEW.payment_id := OLD.payment_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_promotions_protect_activation ON public.property_promotions;
CREATE TRIGGER property_promotions_protect_activation
  BEFORE INSERT OR UPDATE ON public.property_promotions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_promotion_activation();

CREATE OR REPLACE FUNCTION public.protect_notification_contents()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;
  NEW.user_id := OLD.user_id;
  NEW.type := OLD.type;
  NEW.title := OLD.title;
  NEW.message := OLD.message;
  NEW.data := OLD.data;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_protect_contents ON public.notifications;
CREATE TRIGGER notifications_protect_contents
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_notification_contents();

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agency_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_amenities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Profiles and roles
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS user_profiles_select ON public.user_profiles;
CREATE POLICY user_profiles_select ON public.user_profiles
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS user_profiles_update_own ON public.user_profiles;
CREATE POLICY user_profiles_update_own ON public.user_profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS user_roles_select ON public.user_roles;
CREATE POLICY user_roles_select ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS user_roles_insert ON public.user_roles;
CREATE POLICY user_roles_insert ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS user_roles_update ON public.user_roles;
CREATE POLICY user_roles_update ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS user_roles_delete ON public.user_roles;
CREATE POLICY user_roles_delete ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Agencies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS agencies_select ON public.agencies;
CREATE POLICY agencies_select ON public.agencies
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS agencies_insert ON public.agencies;
CREATE POLICY agencies_insert ON public.agencies
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS agencies_update ON public.agencies;
CREATE POLICY agencies_update ON public.agencies
  FOR UPDATE TO authenticated
  USING (public.can_manage_agency(id))
  WITH CHECK (public.can_manage_agency(id));

DROP POLICY IF EXISTS agencies_delete ON public.agencies;
CREATE POLICY agencies_delete ON public.agencies
  FOR DELETE TO authenticated
  USING (public.agency_role(id) = 'owner' OR public.is_super_admin());

DROP POLICY IF EXISTS agency_members_select ON public.agency_members;
CREATE POLICY agency_members_select ON public.agency_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.agency_role(agency_id) IS NOT NULL
    OR public.is_admin()
  );

DROP POLICY IF EXISTS agency_members_insert ON public.agency_members;
CREATE POLICY agency_members_insert ON public.agency_members
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_agency_member(agency_id, role));

DROP POLICY IF EXISTS agency_members_update ON public.agency_members;
CREATE POLICY agency_members_update ON public.agency_members
  FOR UPDATE TO authenticated
  USING (public.can_manage_agency_member(agency_id, role))
  WITH CHECK (public.can_manage_agency_member(agency_id, role));

DROP POLICY IF EXISTS agency_members_delete ON public.agency_members;
CREATE POLICY agency_members_delete ON public.agency_members
  FOR DELETE TO authenticated
  USING (
    public.can_manage_agency_member(agency_id, role)
    OR (user_id = auth.uid() AND role <> 'owner')
  );

-- ---------------------------------------------------------------------------
-- Catalogs
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS property_categories_select ON public.property_categories;
CREATE POLICY property_categories_select ON public.property_categories
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS property_categories_write ON public.property_categories;
CREATE POLICY property_categories_write ON public.property_categories
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS amenities_select ON public.amenities;
CREATE POLICY amenities_select ON public.amenities
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS amenities_write ON public.amenities;
CREATE POLICY amenities_write ON public.amenities
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS subscription_plans_select ON public.subscription_plans;
CREATE POLICY subscription_plans_select ON public.subscription_plans
  FOR SELECT TO anon, authenticated
  USING (is_active OR public.is_admin());

DROP POLICY IF EXISTS subscription_plans_write ON public.subscription_plans;
CREATE POLICY subscription_plans_write ON public.subscription_plans
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Properties
-- Any authenticated user may insert a row they own. No role is required.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS properties_select ON public.properties;
CREATE POLICY properties_select ON public.properties
  FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    OR owner_id = auth.uid()
    OR public.is_admin()
    OR (agency_id IS NOT NULL AND public.agency_role(agency_id) IS NOT NULL)
  );

DROP POLICY IF EXISTS properties_insert_own ON public.properties;
CREATE POLICY properties_insert_own ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS properties_update_own ON public.properties;
CREATE POLICY properties_update_own ON public.properties
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS properties_delete_own ON public.properties;
CREATE POLICY properties_delete_own ON public.properties
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin());

-- Child rows that are public when the listing is visible, and writable by the owner.

DROP POLICY IF EXISTS property_locations_select ON public.property_locations;
CREATE POLICY property_locations_select ON public.property_locations
  FOR SELECT TO anon, authenticated
  USING (public.can_view_property(property_id));

DROP POLICY IF EXISTS property_locations_write ON public.property_locations;
CREATE POLICY property_locations_write ON public.property_locations
  FOR ALL TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin())
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_images_select ON public.property_images;
CREATE POLICY property_images_select ON public.property_images
  FOR SELECT TO anon, authenticated
  USING (public.can_view_property(property_id));

DROP POLICY IF EXISTS property_images_write ON public.property_images;
CREATE POLICY property_images_write ON public.property_images
  FOR ALL TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin())
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_videos_select ON public.property_videos;
CREATE POLICY property_videos_select ON public.property_videos
  FOR SELECT TO anon, authenticated
  USING (public.can_view_property(property_id));

DROP POLICY IF EXISTS property_videos_write ON public.property_videos;
CREATE POLICY property_videos_write ON public.property_videos
  FOR ALL TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin())
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_amenities_select ON public.property_amenities;
CREATE POLICY property_amenities_select ON public.property_amenities
  FOR SELECT TO anon, authenticated
  USING (public.can_view_property(property_id));

DROP POLICY IF EXISTS property_amenities_write ON public.property_amenities;
CREATE POLICY property_amenities_write ON public.property_amenities
  FOR ALL TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin())
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_features_select ON public.property_features;
CREATE POLICY property_features_select ON public.property_features
  FOR SELECT TO anon, authenticated
  USING (public.can_view_property(property_id));

DROP POLICY IF EXISTS property_features_write ON public.property_features;
CREATE POLICY property_features_write ON public.property_features
  FOR ALL TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin())
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_prices_select ON public.property_prices;
CREATE POLICY property_prices_select ON public.property_prices
  FOR SELECT TO anon, authenticated
  USING (public.can_view_property(property_id));

DROP POLICY IF EXISTS property_prices_write ON public.property_prices;
CREATE POLICY property_prices_write ON public.property_prices
  FOR ALL TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin())
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

-- Documents stay private.
DROP POLICY IF EXISTS property_documents_select ON public.property_documents;
CREATE POLICY property_documents_select ON public.property_documents
  FOR SELECT TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_documents_insert ON public.property_documents;
CREATE POLICY property_documents_insert ON public.property_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.owns_property(property_id) AND uploaded_by = auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS property_documents_update ON public.property_documents;
CREATE POLICY property_documents_update ON public.property_documents
  FOR UPDATE TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin())
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_documents_delete ON public.property_documents;
CREATE POLICY property_documents_delete ON public.property_documents
  FOR DELETE TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_verifications_select ON public.property_verifications;
CREATE POLICY property_verifications_select ON public.property_verifications
  FOR SELECT TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_verifications_insert ON public.property_verifications;
CREATE POLICY property_verifications_insert ON public.property_verifications
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.owns_property(property_id) AND submitted_by = auth.uid())
    OR public.is_admin()
  );

DROP POLICY IF EXISTS property_verifications_update ON public.property_verifications;
CREATE POLICY property_verifications_update ON public.property_verifications
  FOR UPDATE TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin())
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_status_history_select ON public.property_status_history;
CREATE POLICY property_status_history_select ON public.property_status_history
  FOR SELECT TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin());

-- ---------------------------------------------------------------------------
-- Favorites, views, inquiries, visits, reports
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS property_favorites_select ON public.property_favorites;
CREATE POLICY property_favorites_select ON public.property_favorites
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS property_favorites_insert ON public.property_favorites;
CREATE POLICY property_favorites_insert ON public.property_favorites
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS property_favorites_delete ON public.property_favorites;
CREATE POLICY property_favorites_delete ON public.property_favorites
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS property_views_insert_anon ON public.property_views;
CREATE POLICY property_views_insert_anon ON public.property_views
  FOR INSERT TO anon
  WITH CHECK (user_id IS NULL);

DROP POLICY IF EXISTS property_views_insert_user ON public.property_views;
CREATE POLICY property_views_insert_user ON public.property_views
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS property_views_select ON public.property_views;
CREATE POLICY property_views_select ON public.property_views
  FOR SELECT TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_inquiries_insert ON public.property_inquiries;
CREATE POLICY property_inquiries_insert ON public.property_inquiries
  FOR INSERT TO authenticated
  WITH CHECK (buyer_id = auth.uid());

DROP POLICY IF EXISTS property_inquiries_select ON public.property_inquiries;
CREATE POLICY property_inquiries_select ON public.property_inquiries
  FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    OR public.owns_property(property_id)
    OR public.is_admin()
  );

DROP POLICY IF EXISTS property_inquiries_update ON public.property_inquiries;
CREATE POLICY property_inquiries_update ON public.property_inquiries
  FOR UPDATE TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin())
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_visits_insert ON public.property_visits;
CREATE POLICY property_visits_insert ON public.property_visits
  FOR INSERT TO authenticated
  WITH CHECK (buyer_id = auth.uid() AND status = 'requested');

DROP POLICY IF EXISTS property_visits_select ON public.property_visits;
CREATE POLICY property_visits_select ON public.property_visits
  FOR SELECT TO authenticated
  USING (
    buyer_id = auth.uid()
    OR agent_id = auth.uid()
    OR public.owns_property(property_id)
    OR public.is_admin()
  );

DROP POLICY IF EXISTS property_visits_update ON public.property_visits;
CREATE POLICY property_visits_update ON public.property_visits
  FOR UPDATE TO authenticated
  USING (
    buyer_id = auth.uid()
    OR agent_id = auth.uid()
    OR public.owns_property(property_id)
    OR public.is_admin()
  )
  WITH CHECK (
    buyer_id = auth.uid()
    OR agent_id = auth.uid()
    OR public.owns_property(property_id)
    OR public.is_admin()
  );

DROP POLICY IF EXISTS property_reports_insert ON public.property_reports;
CREATE POLICY property_reports_insert ON public.property_reports
  FOR INSERT TO authenticated
  WITH CHECK (reported_by = auth.uid());

DROP POLICY IF EXISTS property_reports_select ON public.property_reports;
CREATE POLICY property_reports_select ON public.property_reports
  FOR SELECT TO authenticated
  USING (reported_by = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS property_reports_update ON public.property_reports;
CREATE POLICY property_reports_update ON public.property_reports
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Saved searches, projects, billing, notifications
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS saved_searches_all ON public.saved_searches;
CREATE POLICY saved_searches_all ON public.saved_searches
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS property_projects_select ON public.property_projects;
CREATE POLICY property_projects_select ON public.property_projects
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS property_projects_write ON public.property_projects;
CREATE POLICY property_projects_write ON public.property_projects
  FOR ALL TO authenticated
  USING (public.is_admin() OR (agency_id IS NOT NULL AND public.can_manage_agency(agency_id)))
  WITH CHECK (public.is_admin() OR (agency_id IS NOT NULL AND public.can_manage_agency(agency_id)));

DROP POLICY IF EXISTS project_units_select ON public.project_units;
CREATE POLICY project_units_select ON public.project_units
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS project_units_write ON public.project_units;
CREATE POLICY project_units_write ON public.project_units
  FOR ALL TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS subscriptions_select ON public.subscriptions;
CREATE POLICY subscriptions_select ON public.subscriptions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (agency_id IS NOT NULL AND public.can_manage_agency(agency_id))
    OR public.is_admin()
  );

DROP POLICY IF EXISTS subscriptions_insert ON public.subscriptions;
CREATE POLICY subscriptions_insert ON public.subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (user_id = auth.uid() AND status = 'pending')
  );

DROP POLICY IF EXISTS subscriptions_update ON public.subscriptions;
CREATE POLICY subscriptions_update ON public.subscriptions
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS payments_insert ON public.payments;
CREATE POLICY payments_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS payments_update ON public.payments;
CREATE POLICY payments_update ON public.payments
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS property_promotions_select ON public.property_promotions;
CREATE POLICY property_promotions_select ON public.property_promotions
  FOR SELECT TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_promotions_insert ON public.property_promotions;
CREATE POLICY property_promotions_insert ON public.property_promotions
  FOR INSERT TO authenticated
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS property_promotions_update ON public.property_promotions;
CREATE POLICY property_promotions_update ON public.property_promotions
  FOR UPDATE TO authenticated
  USING (public.owns_property(property_id) OR public.is_admin())
  WITH CHECK (public.owns_property(property_id) OR public.is_admin());

DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants
-- Anonymous clients can browse published listings. Phone and email stay off that grant.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

GRANT SELECT ON
  public.property_categories,
  public.amenities,
  public.properties,
  public.property_locations,
  public.property_images,
  public.property_videos,
  public.property_amenities,
  public.property_features,
  public.property_prices,
  public.agencies,
  public.property_projects,
  public.project_units,
  public.subscription_plans
TO anon;

GRANT SELECT (
  id,
  full_name,
  avatar_url,
  bio,
  city,
  district,
  state,
  is_verified,
  created_at
) ON public.user_profiles TO anon;

GRANT INSERT ON public.property_views TO anon;
GRANT EXECUTE ON FUNCTION public.properties_within_radius(double precision, double precision, double precision) TO anon;
GRANT EXECUTE ON FUNCTION public.property_favorite_count(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon;
GRANT EXECUTE ON FUNCTION public.can_view_property(uuid) TO anon;

-- ---------------------------------------------------------------------------
-- Storage buckets for listing photos and private documents
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'property-images',
  'property-images',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']::text[]
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'property-documents',
  'property-documents',
  false,
  20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS property_images_storage_read ON storage.objects;
CREATE POLICY property_images_storage_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'property-images');

DROP POLICY IF EXISTS property_images_storage_insert ON storage.objects;
CREATE POLICY property_images_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'property-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS property_images_storage_update ON storage.objects;
CREATE POLICY property_images_storage_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS property_images_storage_delete ON storage.objects;
CREATE POLICY property_images_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );

DROP POLICY IF EXISTS property_documents_storage_all ON storage.objects;
CREATE POLICY property_documents_storage_all ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'property-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  )
  WITH CHECK (
    bucket_id = 'property-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin()
    )
  );
