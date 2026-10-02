-- Listing publish, saves, and chat messages should not create notifications.
-- Alerts stay with another person's enquiry, a visit request, and a visit confirmation
-- sent only to the person who requested the visit.

DROP TRIGGER IF EXISTS properties_notify_status ON public.properties;
DROP TRIGGER IF EXISTS property_favorites_notify_owner ON public.property_favorites;
DROP TRIGGER IF EXISTS chat_messages_notify ON public.chat_messages;

CREATE OR REPLACE FUNCTION public.notify_visit_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  listing_title text;
  confirmer uuid;
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.status IS DISTINCT FROM 'confirmed' OR OLD.status = 'confirmed' THEN
    RETURN NEW;
  END IF;

  IF NEW.buyer_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    confirmer := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  EXCEPTION WHEN others THEN
    confirmer := NULL;
  END;

  -- The person who requested the visit is the only recipient.
  IF confirmer IS NOT NULL AND confirmer = NEW.buyer_id THEN
    RETURN NEW;
  END IF;

  SELECT p.title INTO listing_title
  FROM public.properties AS p
  WHERE p.id = NEW.property_id;

  INSERT INTO public.notifications (user_id, type, title, message, data)
  VALUES (
    NEW.buyer_id,
    'visit_confirmed',
    'Visit confirmed',
    'Your visit for ' || COALESCE(listing_title, 'the property') || ' is confirmed.',
    jsonb_build_object('property_id', NEW.property_id, 'visit_id', NEW.id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_visits_notify_confirmed ON public.property_visits;
CREATE TRIGGER property_visits_notify_confirmed
  AFTER UPDATE OF status ON public.property_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_visit_confirmed();

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_kind TEXT;

ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_body_check;
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_content_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_content_check CHECK (
    char_length(btrim(COALESCE(body, ''))) > 0
    OR nullif(btrim(COALESCE(attachment_url, '')), '') IS NOT NULL
  );

ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_attachment_kind_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_attachment_kind_check CHECK (
    attachment_kind IS NULL OR attachment_kind IN ('image', 'document')
  );
