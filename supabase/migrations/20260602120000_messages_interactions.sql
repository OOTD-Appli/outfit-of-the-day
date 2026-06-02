-- OOTD — Chat : like + suppression de messages, en temps réel (2026-06-02)
-- - is_liked : le DESTINATAIRE peut liker un message reçu.
-- - is_deleted : l'EXPÉDITEUR peut supprimer (soft) son message → "Ce message a été supprimé".
-- Les deux passent par des RPC SECURITY DEFINER (pas d'UPDATE direct côté client).
-- Realtime activé sur `messages` pour la synchro instantanée des deux côtés.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_liked   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;

-- ===========================================================================
-- Realtime : diffuser les changements (INSERT/UPDATE) aux participants
-- ===========================================================================
ALTER TABLE public.messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

-- ===========================================================================
-- RPC : toggle_message_like — seul le destinataire peut liker un message reçu
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.toggle_message_like(p_id uuid, p_liked boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE messages
     SET is_liked = coalesce(p_liked, false)
   WHERE id = p_id
     AND receiver_id = auth.uid()
     AND is_deleted = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Message non likable');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ===========================================================================
-- RPC : delete_message — soft delete, seul l'expéditeur. Renvoie l'image_url
--       (avant effacement) pour que le client nettoie le Storage.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.delete_message(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_img    text;
  v_sender uuid;
BEGIN
  SELECT image_url, sender_id INTO v_img, v_sender FROM messages WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Message introuvable');
  END IF;
  IF v_sender IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non autorisé');
  END IF;

  UPDATE messages
     SET is_deleted = true, content = NULL, image_url = NULL, is_liked = false
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'image_url', v_img);
END;
$$;
