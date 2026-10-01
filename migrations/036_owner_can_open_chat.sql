-- Owners can open a chat with the buyer who enquired.

DROP POLICY IF EXISTS conversations_insert ON public.conversations;
CREATE POLICY conversations_insert ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (
    buyer_id <> owner_id
    AND owner_id = (SELECT p.owner_id FROM public.properties AS p WHERE p.id = property_id)
    AND (buyer_id = auth.uid() OR owner_id = auth.uid())
  );
