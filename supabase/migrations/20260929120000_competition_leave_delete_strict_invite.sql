-- OOTD — Compétitions : quitter, supprimer (créateur), invitation stricte (2026-09-29)
-- Audit demandé par l'utilisateur des 3 règles métier du cahier des charges
-- Compétitions v2 contre l'implémentation réelle. 3 écarts trouvés :
--
--   1. "N'importe quel participant peut quitter" : la RLS le permettait déjà
--      (competition_members_delete_self, DELETE ... USING (user_id = auth.uid())),
--      mais aucune RPC/bouton ne l'exposait proprement — le client aurait dû
--      faire un DELETE brut sans retour d'erreur homogène avec le reste de l'app.
--   2. "Seul le créateur peut supprimer" : AUCUNE RPC ni policy RLS DELETE
--      n'existait sur `competitions` — personne, pas même le créateur, ne
--      pouvait supprimer une compétition avant cette migration.
--   3. "On ne peut inviter que des amis acceptés" : vrai uniquement à la
--      création (create_competition_with_members le vérifie déjà) — le
--      système de lien d'invitation (create_competition_invite/
--      redeem_competition_invite, pour ajouter des membres après coup) ne
--      vérifiait aucune amitié : n'importe qui avec le lien pouvait rejoindre.

-- ===========================================================================
-- 1. leave_competition — quitter (n'importe quel membre, y compris le créateur)
-- ===========================================================================
-- Note : si le créateur quitte, la compétition continue d'exister pour les
-- membres restants (created_by ne change pas) — delete_competition reste
-- utilisable par l'ex-créateur ci-dessous (vérifié sur created_by, pas sur
-- l'appartenance actuelle), pour ne jamais laisser une compétition orpheline
-- de façon définitive.

CREATE OR REPLACE FUNCTION public.leave_competition(p_competition_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Non authentifié'); END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competition_members WHERE competition_id = p_competition_id AND user_id = v_uid
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tu n''es pas membre de cette compétition');
  END IF;

  DELETE FROM competition_members WHERE competition_id = p_competition_id AND user_id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.leave_competition(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_competition(uuid) TO authenticated;

-- ===========================================================================
-- 2. delete_competition — créateur uniquement, supprime pour tout le monde
-- ===========================================================================
-- Vérifie created_by directement (pas la RLS/appartenance actuelle) : un
-- créateur qui a quitté sa propre compétition (via leave_competition
-- ci-dessus) doit pouvoir la supprimer quand même, plutôt que la laisser
-- orpheline pour toujours.
-- Cascade déjà en place sur toutes les FK (competition_members,
-- ootd_competitions, competition_messages, competition_invites,
-- competition_message_likes/reactions référencent toutes competitions/
-- competition_messages en ON DELETE CASCADE) : un simple DELETE FROM
-- competitions suffit à tout nettoyer proprement.

CREATE OR REPLACE FUNCTION public.delete_competition(p_competition_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_owner  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Non authentifié'); END IF;

  SELECT created_by INTO v_owner FROM competitions WHERE id = p_competition_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Compétition introuvable');
  END IF;
  IF v_owner <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Seul le créateur peut supprimer cette compétition');
  END IF;

  DELETE FROM competitions WHERE id = p_competition_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_competition(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_competition(uuid) TO authenticated;

-- ===========================================================================
-- 3. redeem_competition_invite — n'accepte que les amis acceptés de la
--    personne qui a créé le lien (created_by), même check que
--    create_competition_with_members (2026-09-23).
-- ===========================================================================
-- CREATE OR REPLACE avec la même signature (p_token text) : pas besoin de
-- DROP, aucune ambiguïté de surcharge.

CREATE OR REPLACE FUNCTION public.redeem_competition_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv record;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'auth_required'); END IF;

  SELECT * INTO v_inv FROM competition_invites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Lien invalide'); END IF;
  IF v_inv.revoked_at IS NOT NULL OR v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lien expiré');
  END IF;

  IF EXISTS (SELECT 1 FROM competition_members WHERE competition_id = v_inv.competition_id AND user_id = v_uid) THEN
    SELECT name INTO v_name FROM competitions WHERE id = v_inv.competition_id;
    RETURN jsonb_build_object('ok', true, 'already_member', true, 'competition_id', v_inv.competition_id, 'competition_name', v_name);
  END IF;

  IF v_inv.max_uses IS NOT NULL AND v_inv.use_count >= v_inv.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lien épuisé');
  END IF;

  -- Contrainte stricte : on ne peut rejoindre via un lien que si on est ami
  -- accepté (dans un sens ou l'autre) avec la personne qui l'a créé.
  IF NOT EXISTS (
    SELECT 1 FROM friendships f
    WHERE f.status = 'accepted'
      AND ((f.user_id = v_uid AND f.friend_id = v_inv.created_by) OR (f.user_id = v_inv.created_by AND f.friend_id = v_uid))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tu dois être ami avec la personne qui a partagé ce lien pour rejoindre cette compétition');
  END IF;

  INSERT INTO competition_members (competition_id, user_id) VALUES (v_inv.competition_id, v_uid);
  UPDATE competition_invites SET use_count = use_count + 1 WHERE token = p_token;

  SELECT name INTO v_name FROM competitions WHERE id = v_inv.competition_id;
  RETURN jsonb_build_object('ok', true, 'competition_id', v_inv.competition_id, 'competition_name', v_name);
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_competition_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_competition_invite(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
