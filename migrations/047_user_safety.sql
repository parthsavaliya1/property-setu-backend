CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
CREATE POLICY own_blocks_select ON public.user_blocks FOR SELECT TO authenticated USING (blocker_id = auth.uid());
CREATE POLICY own_blocks_insert ON public.user_blocks FOR INSERT TO authenticated WITH CHECK (blocker_id = auth.uid());
CREATE POLICY own_blocks_delete ON public.user_blocks FOR DELETE TO authenticated USING (blocker_id = auth.uid());

CREATE FUNCTION public.users_blocked(a uuid, b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL OR (auth.uid() IS DISTINCT FROM a AND auth.uid() IS DISTINCT FROM b) THEN false
    ELSE EXISTS (SELECT 1 FROM user_blocks WHERE (blocker_id = a AND blocked_id = b) OR (blocker_id = b AND blocked_id = a)) END;
$$;
REVOKE ALL ON FUNCTION public.users_blocked(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.users_blocked(uuid, uuid) TO authenticated, anon;

-- Enforce blocks in the database too, including inserts outside the HTTP API.
CREATE FUNCTION public.enforce_chat_block() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE buyer uuid; owner uuid;
BEGIN
  IF TG_TABLE_NAME = 'conversations' THEN
    buyer := NEW.buyer_id; owner := NEW.owner_id;
  ELSIF TG_TABLE_NAME IN ('property_inquiries', 'property_visits') THEN
    buyer := NEW.buyer_id;
    SELECT owner_id INTO owner FROM properties WHERE id = NEW.property_id;
  ELSIF TG_TABLE_NAME = 'chat_message_reactions' THEN
    SELECT c.buyer_id, c.owner_id INTO buyer, owner FROM conversations c JOIN chat_messages m ON m.conversation_id = c.id WHERE m.id = NEW.message_id;
  ELSE
    SELECT buyer_id, owner_id INTO buyer, owner FROM conversations WHERE id = NEW.conversation_id;
  END IF;
  IF public.users_blocked(buyer, owner) THEN
    RAISE EXCEPTION 'Messaging is unavailable because a user is blocked' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversation_block BEFORE INSERT ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block();
CREATE TRIGGER message_block BEFORE INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block();
CREATE TRIGGER reaction_block BEFORE INSERT OR UPDATE ON public.chat_message_reactions FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block();
CREATE TRIGGER inquiry_block BEFORE INSERT ON public.property_inquiries FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block();
CREATE TRIGGER visit_block BEFORE INSERT ON public.property_visits FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_block();

-- Keep user/chat reports in the existing administrator moderation queue.
ALTER TABLE public.property_reports ALTER COLUMN property_id DROP NOT NULL;
ALTER TABLE public.property_reports ADD COLUMN reported_user_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.property_reports ADD COLUMN conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL;
ALTER TABLE public.property_reports ADD COLUMN message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL;
ALTER TABLE public.property_reports ADD COLUMN reported_content text;
