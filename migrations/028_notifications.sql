-- In-app notifications. data holds ids the client needs to open the right screen.

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  data JSONB,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS
  'Alerts such as a new inquiry, visit reminder, approval, rejection, or subscription expiry.';
COMMENT ON COLUMN public.notifications.type IS
  'Examples: new_inquiry, price_change, visit_reminder, property_approved, property_rejected, subscription_expiry, new_match, new_message.';
COMMENT ON COLUMN public.notifications.data IS
  'JSON payload, for example {"property_id": "...", "inquiry_id": "..."}.';

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, is_read, created_at DESC);

-- Owners are told when someone inquires, without giving the buyer insert rights on notifications.
CREATE OR REPLACE FUNCTION public.notify_property_owner_of_inquiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner uuid;
  listing_title text;
BEGIN
  SELECT p.owner_id, p.title
  INTO owner, listing_title
  FROM public.properties AS p
  WHERE p.id = NEW.property_id;

  IF owner IS NOT NULL AND owner IS DISTINCT FROM NEW.buyer_id THEN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
      owner,
      'new_inquiry',
      'New inquiry',
      COALESCE(NEW.name, 'Someone') || ' asked about ' || COALESCE(listing_title, 'your property'),
      jsonb_build_object('property_id', NEW.property_id, 'inquiry_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_inquiries_notify_owner ON public.property_inquiries;
CREATE TRIGGER property_inquiries_notify_owner
  AFTER INSERT ON public.property_inquiries
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_property_owner_of_inquiry();

CREATE OR REPLACE FUNCTION public.notify_property_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('published', 'rejected') THEN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
      NEW.owner_id,
      CASE WHEN NEW.status = 'published' THEN 'property_approved' ELSE 'property_rejected' END,
      CASE WHEN NEW.status = 'published' THEN 'Property published' ELSE 'Property rejected' END,
      CASE
        WHEN NEW.status = 'published' THEN '"' || NEW.title || '" is now live.'
        ELSE '"' || NEW.title || '" was rejected.'
      END,
      jsonb_build_object('property_id', NEW.id, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_notify_status ON public.properties;
CREATE TRIGGER properties_notify_status
  AFTER UPDATE OF status ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_property_status();
