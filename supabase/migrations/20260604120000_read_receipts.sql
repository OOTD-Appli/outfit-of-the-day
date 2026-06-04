-- OOTD — Accusés de lecture (2026-06-04)
-- read_at : horodatage de première lecture par le destinataire (primitif, aucun média).
-- NULL = non lu. Mis à jour uniquement par le destinataire via RPC SECURITY DEFINER.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Marque comme lus tous les messages reçus de p_friend_id encore non lus.
-- Seul le destinataire (auth.uid()) peut le faire ; l'UPDATE propage en Realtime
-- (REPLICA IDENTITY FULL déjà actif) → l'expéditeur voit l'accusé instantanément.
CREATE OR REPLACE FUNCTION public.mark_messages_read(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE messages
     SET read_at = now()
   WHERE receiver_id = auth.uid()
     AND sender_id = p_friend_id
     AND read_at IS NULL
     AND is_deleted = false;
END;
$$;
