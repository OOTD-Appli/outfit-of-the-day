-- OOTD — Corrige 2 bugs bloquants découverts en test réel (2026-09-24)
--
-- 1. "infinite recursion detected in policy for relation competition_members" :
--    competition_members_select_member vérifiait l'appartenance en
--    re-interrogeant competition_members elle-même dans un EXISTS — chaque
--    lecture de la table redéclenche sa propre policy, qui relit la table,
--    qui redéclenche la policy... Le correctif standard Supabase/Postgres :
--    déporter la vérification dans une fonction SECURITY DEFINER (son
--    propriétaire — postgres — n'est pas soumis au RLS de ses propres
--    tables, donc l'appel ne redéclenche pas la policy).
--
-- 2. "Could not find a relationship between 'competition_messages' and
--    'profiles'" : sender_id référençait auth.users(id), un schéma que
--    PostgREST ne peut pas utiliser pour résoudre un embed profiles(...)
--    dans un .select(). Même piège déjà rencontré et corrigé sur
--    ootds/likes/friendships/flammes/snaps lors de la migration self-host —
--    raté ici parce que ces tables sont nouvelles. Comme profiles.id
--    référence déjà auth.users(id) (garanti par ensureUserProfile), pointer
--    directement vers profiles(id) préserve l'intégrité référentielle tout
--    en réparant l'embed PostgREST.

-- ===========================================================================
-- 1. Helper SECURITY DEFINER (casse la récursion)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.is_competition_member(p_competition_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM competition_members
    WHERE competition_id = p_competition_id AND user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_competition_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_competition_member(uuid) TO authenticated;

-- Rejoue toutes les policies "membre de cette compétition" avec le helper
-- (la seule vraiment auto-référentielle est competition_members_select_member,
-- mais les autres passent aussi par le helper pour rester cohérentes/rapides).

DROP POLICY IF EXISTS "competitions_select_member" ON public.competitions;
CREATE POLICY "competitions_select_member"
  ON public.competitions FOR SELECT TO authenticated
  USING (is_competition_member(id));

DROP POLICY IF EXISTS "competition_members_select_member" ON public.competition_members;
CREATE POLICY "competition_members_select_member"
  ON public.competition_members FOR SELECT TO authenticated
  USING (is_competition_member(competition_id));

DROP POLICY IF EXISTS "ootd_competitions_select_member" ON public.ootd_competitions;
CREATE POLICY "ootd_competitions_select_member"
  ON public.ootd_competitions FOR SELECT TO authenticated
  USING (is_competition_member(competition_id));

DROP POLICY IF EXISTS "ootd_competitions_insert_own" ON public.ootd_competitions;
CREATE POLICY "ootd_competitions_insert_own"
  ON public.ootd_competitions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.ootds o WHERE o.id = ootd_id AND o.user_id = (SELECT auth.uid()))
    AND is_competition_member(competition_id)
  );

DROP POLICY IF EXISTS "competition_invites_select_member" ON public.competition_invites;
CREATE POLICY "competition_invites_select_member"
  ON public.competition_invites FOR SELECT TO authenticated
  USING (is_competition_member(competition_id));

DROP POLICY IF EXISTS "competition_messages_select_member" ON public.competition_messages;
CREATE POLICY "competition_messages_select_member"
  ON public.competition_messages FOR SELECT TO authenticated
  USING (is_competition_member(competition_id));

DROP POLICY IF EXISTS "competition_messages_insert_member" ON public.competition_messages;
CREATE POLICY "competition_messages_insert_member"
  ON public.competition_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND is_competition_member(competition_id)
  );

-- ===========================================================================
-- 2. FK competition_messages.sender_id -> profiles(id) (au lieu de auth.users)
-- ===========================================================================

ALTER TABLE public.competition_messages DROP CONSTRAINT IF EXISTS competition_messages_sender_id_fkey;
ALTER TABLE public.competition_messages
  ADD CONSTRAINT competition_messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
