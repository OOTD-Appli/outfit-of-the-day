-- Migration : reply_to_id sur messages (swipe-to-reply)
-- La FK est NULL-able et ON DELETE SET NULL : si le message parent est supprimé
-- (soft-delete ou purge 24h), la référence disparaît proprement.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid
    REFERENCES public.messages(id) ON DELETE SET NULL;

-- Index pour les jointures "charger le message cité"
CREATE INDEX IF NOT EXISTS messages_reply_to_id_idx
  ON public.messages(reply_to_id)
  WHERE reply_to_id IS NOT NULL;
