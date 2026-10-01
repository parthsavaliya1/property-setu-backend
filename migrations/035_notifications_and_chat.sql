-- Notify the owner when a listing is saved or a visit is requested.
-- Chat threads let a buyer and the owner talk about one property.

CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conversations_not_self CHECK (buyer_id <> owner_id),
  CONSTRAINT conversations_property_buyer UNIQUE (property_id, buyer_id)
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_body_check CHECK (char_length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON public.chat_messages (conversation_id, created_at);

CREATE OR REPLACE FUNCTION public.notify_property_owner_of_inquiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner uuid;
  listing_title text;
  conversation uuid;
BEGIN
  SELECT p.owner_id, p.title
  INTO owner, listing_title
  FROM public.properties AS p
  WHERE p.id = NEW.property_id;

  SELECT c.id INTO conversation
  FROM public.conversations AS c
  WHERE c.property_id = NEW.property_id AND c.buyer_id = NEW.buyer_id
  LIMIT 1;

  IF owner IS NOT NULL AND owner IS DISTINCT FROM NEW.buyer_id THEN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
      owner,
      'new_inquiry',
      'New inquiry',
      COALESCE(NEW.name, 'Someone') || ' asked about ' || COALESCE(listing_title, 'your property'),
      jsonb_build_object(
        'property_id', NEW.property_id,
        'inquiry_id', NEW.id,
        'buyer_id', NEW.buyer_id,
        'conversation_id', conversation
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_property_owner_of_favorite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner uuid;
  listing_title text;
  saver text;
BEGIN
  SELECT p.owner_id, p.title
  INTO owner, listing_title
  FROM public.properties AS p
  WHERE p.id = NEW.property_id;

  IF owner IS NULL OR owner = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'Someone')
  INTO saver
  FROM public.user_profiles
  WHERE id = NEW.user_id;

  INSERT INTO public.notifications (user_id, type, title, message, data)
  VALUES (
    owner,
    'property_saved',
    'Property saved',
    COALESCE(saver, 'Someone') || ' saved ' || COALESCE(listing_title, 'your property'),
    jsonb_build_object('property_id', NEW.property_id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_favorites_notify_owner ON public.property_favorites;
CREATE TRIGGER property_favorites_notify_owner
  AFTER INSERT ON public.property_favorites
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_property_owner_of_favorite();

CREATE OR REPLACE FUNCTION public.notify_property_owner_of_visit()
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
      'visit_request',
      'Visit request',
      'Someone wants to visit ' || COALESCE(listing_title, 'your property'),
      jsonb_build_object('property_id', NEW.property_id, 'visit_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS property_visits_notify_owner ON public.property_visits;
CREATE TRIGGER property_visits_notify_owner
  AFTER INSERT ON public.property_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_property_owner_of_visit();

CREATE OR REPLACE FUNCTION public.notify_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  thread public.conversations%ROWTYPE;
  recipient uuid;
  sender_name text;
BEGIN
  IF current_setting('app.skip_chat_notify', true) = '1' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO thread FROM public.conversations WHERE id = NEW.conversation_id;
  IF thread.id IS NULL THEN
    RETURN NEW;
  END IF;

  recipient := CASE WHEN NEW.sender_id = thread.buyer_id THEN thread.owner_id ELSE thread.buyer_id END;
  IF recipient IS NULL OR recipient = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'Someone')
  INTO sender_name
  FROM public.user_profiles
  WHERE id = NEW.sender_id;

  INSERT INTO public.notifications (user_id, type, title, message, data)
  VALUES (
    recipient,
    'new_message',
    'New message',
    COALESCE(sender_name, 'Someone') || ': ' || left(NEW.body, 140),
    jsonb_build_object('property_id', thread.property_id, 'conversation_id', thread.id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_notify ON public.chat_messages;
CREATE TRIGGER chat_messages_notify
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_chat_message();

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations
  FOR SELECT TO authenticated
  USING (buyer_id = auth.uid() OR owner_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS conversations_insert ON public.conversations;
CREATE POLICY conversations_insert ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    buyer_id <> owner_id
    AND owner_id = (SELECT p.owner_id FROM public.properties AS p WHERE p.id = property_id)
    AND (buyer_id = auth.uid() OR owner_id = auth.uid())
  );

DROP POLICY IF EXISTS chat_messages_select ON public.chat_messages;
CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations AS c
      WHERE c.id = conversation_id
        AND (c.buyer_id = auth.uid() OR c.owner_id = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS chat_messages_insert ON public.chat_messages;
CREATE POLICY chat_messages_insert ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.conversations AS c
      WHERE c.id = conversation_id
        AND (c.buyer_id = auth.uid() OR c.owner_id = auth.uid())
    )
  );

GRANT SELECT, INSERT ON public.conversations TO authenticated;
GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
