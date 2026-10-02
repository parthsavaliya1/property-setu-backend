-- One reaction per person on a chat message. Tapping the same emoji removes it.

CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  message_id UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT chat_message_reactions_emoji_check CHECK (char_length(btrim(emoji)) BETWEEN 1 AND 16)
);

CREATE INDEX IF NOT EXISTS idx_chat_message_reactions_message
  ON public.chat_message_reactions (message_id);

ALTER TABLE public.chat_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_message_reactions_select ON public.chat_message_reactions;
CREATE POLICY chat_message_reactions_select ON public.chat_message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chat_messages AS m
      JOIN public.conversations AS c ON c.id = m.conversation_id
      WHERE m.id = message_id
        AND (c.buyer_id = auth.uid() OR c.owner_id = auth.uid() OR public.is_admin())
    )
  );

DROP POLICY IF EXISTS chat_message_reactions_insert ON public.chat_message_reactions;
CREATE POLICY chat_message_reactions_insert ON public.chat_message_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.chat_messages AS m
      JOIN public.conversations AS c ON c.id = m.conversation_id
      WHERE m.id = message_id
        AND m.deleted_at IS NULL
        AND (c.buyer_id = auth.uid() OR c.owner_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS chat_message_reactions_update ON public.chat_message_reactions;
CREATE POLICY chat_message_reactions_update ON public.chat_message_reactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS chat_message_reactions_delete ON public.chat_message_reactions;
CREATE POLICY chat_message_reactions_delete ON public.chat_message_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_message_reactions TO authenticated;
