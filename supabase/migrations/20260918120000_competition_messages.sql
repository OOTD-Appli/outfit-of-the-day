-- OOTD — Compétitions v2 : chat de groupe (2026-09-18)
-- Remplace le chat 1-à-1 (messages) pour ce contexte. Même pattern de
-- soft-delete que messages/delete_message. Pas d'accusé de lecture par
-- message (complexité inutile pour un chat de groupe) — juste un curseur
-- last_read_at par membre pour calculer un badge "non lu" au niveau de la
-- compétition.

CREATE TABLE IF NOT EXISTS public.competition_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  sender_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content        text,
  image_url      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  is_deleted     boolean NOT NULL DEFAULT false,
  CONSTRAINT competition_messages_has_content
    CHECK (is_deleted = true OR content IS NOT NULL OR image_url IS NOT NULL),
  -- Pattern large (pas seulement *.supabase.co) : la migration self-host a déjà
  -- dû élargir la même contrainte sur ootds/messages pour accepter supabase.myback.fr.
  CONSTRAINT competition_messages_image_url_valid
    CHECK (image_url IS NULL OR image_url ~ '^https://[a-z0-9.-]+/storage/')
);
CREATE INDEX IF NOT EXISTS idx_competition_messages_comp_created ON public.competition_messages(competition_id, created_at DESC);

ALTER TABLE public.competition_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competition_messages_select_member" ON public.competition_messages;
CREATE POLICY "competition_messages_select_member"
  ON public.competition_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.competition_members cm
    WHERE cm.competition_id = competition_messages.competition_id AND cm.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "competition_messages_insert_member" ON public.competition_messages;
CREATE POLICY "competition_messages_insert_member"
  ON public.competition_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.competition_members cm
      WHERE cm.competition_id = competition_messages.competition_id AND cm.user_id = (SELECT auth.uid())
    )
  );
-- Pas de policy UPDATE/DELETE : soft-delete uniquement via delete_competition_message().

CREATE OR REPLACE FUNCTION public.delete_competition_message(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_img text; v_sender uuid;
BEGIN
  SELECT image_url, sender_id INTO v_img, v_sender FROM competition_messages WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Message introuvable'); END IF;
  IF v_sender IS DISTINCT FROM auth.uid() THEN RETURN jsonb_build_object('ok', false, 'error', 'Non autorisé'); END IF;

  UPDATE competition_messages SET is_deleted = true, content = NULL, image_url = NULL WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'image_url', v_img);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_competition_message(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_competition_message(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_competition_read(p_competition_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.competition_members
     SET last_read_at = now()
   WHERE competition_id = p_competition_id AND user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.mark_competition_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_competition_read(uuid) TO authenticated;

-- Realtime : un channel par compétition ouverte, filtré par competition_id
-- (les filtres postgres_changes sont en égalité simple, pas de "IN (liste)" —
-- donc pas de channel global unique possible côté client pour "une de mes
-- compétitions a un nouveau message" ; le client ouvre un channel par
-- compétition dont il est membre, même pattern que les channels par paire
-- de FlammesScreen aujourd'hui).
ALTER TABLE public.competition_messages REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'competition_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.competition_messages;
  END IF;
END $$;
