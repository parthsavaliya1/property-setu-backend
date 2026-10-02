-- Reply quotes and delete-for-everyone on chat messages.
-- A message can only be updated to mark it deleted.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_content_check;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_content_check CHECK (
    deleted_at IS NOT NULL
    OR char_length(btrim(COALESCE(body, ''))) > 0
    OR nullif(btrim(COALESCE(attachment_url, '')), '') IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_chat_messages_reply_to_id ON public.chat_messages (reply_to_id);

CREATE OR REPLACE FUNCTION public.chat_messages_only_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Message already deleted';
  END IF;
  IF NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Messages cannot be edited';
  END IF;
  NEW.sender_id := OLD.sender_id;
  NEW.conversation_id := OLD.conversation_id;
  NEW.reply_to_id := OLD.reply_to_id;
  NEW.created_at := OLD.created_at;
  NEW.body := '';
  NEW.attachment_url := NULL;
  NEW.attachment_name := NULL;
  NEW.attachment_kind := NULL;
  NEW.deleted_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_only_delete ON public.chat_messages;
CREATE TRIGGER chat_messages_only_delete
  BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.chat_messages_only_delete();

DROP POLICY IF EXISTS chat_messages_update ON public.chat_messages;
CREATE POLICY chat_messages_update ON public.chat_messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

GRANT UPDATE ON public.chat_messages TO authenticated;
