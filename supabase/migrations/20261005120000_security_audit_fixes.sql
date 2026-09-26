-- OOTD — Correctifs de l'audit de sécurité complet (2026-09-27)
-- Analyse en 3 volets (RLS/RPC, Edge Functions, client) — voir TACHES.md/
-- ARCHITECTURE.md pour le rapport complet. Ce fichier corrige les points
-- confirmés côté base de données, du plus au moins critique.

-- ===========================================================================
-- 1. CRITIQUE — ootds/likes/comments SELECT en USING (true) : les tenues
--    privées (ootds.is_public=false) et les tenues de comptes privés
--    (profiles.is_private=true) étaient lisibles par N'IMPORTE QUEL
--    utilisateur authentifié via un appel REST direct (aucun filtre RLS,
--    seulement un filtre côté client dans FeedScreen.js). Corrigé pour
--    refléter exactement la règle déjà appliquée côté client :
--      - le propriétaire voit toujours ses propres tenues
--      - les autres ne voient une tenue que si is_public=true ET
--        (le compte n'est pas privé OU ami accepté)
--      - EXCEPTION : les membres d'une compétition à laquelle la tenue a
--        été soumise la voient toujours (submit_ootd_to_competitions
--        accepte is_public=false pour une tenue partagée uniquement dans
--        une compétition, sans passer par le feed public — le carrousel
--        "tenues du jour" doit continuer à fonctionner pour ce cas).
-- ===========================================================================

DROP POLICY IF EXISTS "ootds_select_authenticated" ON public.ootds;
CREATE POLICY "ootds_select_authenticated"
  ON public.ootds FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (
      is_public = true
      AND (
        NOT EXISTS (
          SELECT 1 FROM public.profiles p WHERE p.id = ootds.user_id AND p.is_private = true
        )
        OR EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE f.status = 'accepted'
            AND (
              (f.user_id = (SELECT auth.uid()) AND f.friend_id = ootds.user_id)
              OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = ootds.user_id)
            )
        )
      )
    )
    OR EXISTS (
      -- Tenue soumise à une compétition dont l'appelant est membre, même si
      -- is_public=false (tenue partagée seulement dans la compétition).
      SELECT 1 FROM public.ootd_competitions oc
      WHERE oc.ootd_id = ootds.id AND public.is_competition_member(oc.competition_id)
    )
  );

-- likes/comments : même exposition (qui a liké/commenté une tenue privée
-- était aussi visible par n'importe qui) — alignés sur la visibilité de la
-- tenue elle-même plutôt que dupliquer toute la logique ci-dessus.
DROP POLICY IF EXISTS "likes_select_authenticated" ON public.likes;
CREATE POLICY "likes_select_authenticated"
  ON public.likes FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ootds o
      WHERE o.id = likes.ootd_id
        AND (
          o.user_id = (SELECT auth.uid())
          OR (
            o.is_public = true
            AND (
              NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = o.user_id AND p.is_private = true)
              OR EXISTS (
                SELECT 1 FROM public.friendships f
                WHERE f.status = 'accepted'
                  AND ((f.user_id = (SELECT auth.uid()) AND f.friend_id = o.user_id)
                    OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = o.user_id))
              )
            )
          )
          OR EXISTS (
            SELECT 1 FROM public.ootd_competitions oc
            WHERE oc.ootd_id = o.id AND public.is_competition_member(oc.competition_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS "comments_select_authenticated" ON public.comments;
CREATE POLICY "comments_select_authenticated"
  ON public.comments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ootds o
      WHERE o.id = comments.ootd_id
        AND (
          o.user_id = (SELECT auth.uid())
          OR (
            o.is_public = true
            AND (
              NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = o.user_id AND p.is_private = true)
              OR EXISTS (
                SELECT 1 FROM public.friendships f
                WHERE f.status = 'accepted'
                  AND ((f.user_id = (SELECT auth.uid()) AND f.friend_id = o.user_id)
                    OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = o.user_id))
              )
            )
          )
          OR EXISTS (
            SELECT 1 FROM public.ootd_competitions oc
            WHERE oc.ootd_id = o.id AND public.is_competition_member(oc.competition_id)
          )
        )
    )
  );

-- ===========================================================================
-- 2. HAUTE — friendships_update_recipient ne fige pas user_id/friend_id :
--    le destinataire d'une demande pouvait, en acceptant, réécrire user_id
--    vers un tiers arbitraire et forger une amitié "acceptée" jamais
--    consentie par la victime — contournant le friend-gating des messages/
--    snaps et des compétitions. Un trigger BEFORE UPDATE fige les deux
--    colonnes d'identité (seul `status` doit jamais changer via UPDATE),
--    même principe que profiles_guard_sensitive plus bas.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.friendships_guard_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.user_id := OLD.user_id;
  NEW.friend_id := OLD.friend_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_guard_identity_trigger ON public.friendships;
CREATE TRIGGER friendships_guard_identity_trigger
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW
  EXECUTE FUNCTION public.friendships_guard_identity();

-- ===========================================================================
-- 3. MOYENNE — profiles_guard_sensitive ne protégeait pas analysis_personality
--    (colonne ajoutée après la dernière mise à jour du trigger) : un
--    .update() direct pouvait débloquer une personnalité IA payante sans
--    y avoir droit. Pas exploitable de bout en bout aujourd'hui (l'edge
--    function analyze-outfit revérifie déjà le tier serveur avant d'honorer
--    la personnalité demandée) mais corrigé par principe — toute écriture
--    passe désormais par set_analysis_personality, qui revérifie le tier.
-- ===========================================================================

CREATE OR REPLACE FUNCTION profiles_guard_sensitive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('app.bypass_profile_guard', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  NEW.points               := OLD.points;
  NEW.niveau               := OLD.niveau;
  NEW.has_analysis_pass    := OLD.has_analysis_pass;
  NEW.has_ootd_plus_pass   := OLD.has_ootd_plus_pass;
  NEW.daily_credits        := OLD.daily_credits;
  NEW.credits_reset_date   := OLD.credits_reset_date;
  NEW.unlocked_themes      := OLD.unlocked_themes;
  NEW.unlocked_logos       := OLD.unlocked_logos;
  NEW.active_theme         := OLD.active_theme;
  NEW.active_logo          := OLD.active_logo;
  NEW.flame_freezes        := OLD.flame_freezes;
  NEW.last_freeze_grant    := OLD.last_freeze_grant;
  NEW.analysis_personality := OLD.analysis_personality;

  RETURN NEW;
END;
$$;

-- Miroir exact du gating PERSONA_TIER de supabase/functions/analyze-outfit
-- et lib/tier.js#PERSONA_TIER — à garder synchronisé si la liste évolue.
CREATE OR REPLACE FUNCTION public.set_analysis_personality(p_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_plan       text;
  v_has_legacy boolean;
  v_tier       text;
  v_required   text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Non authentifié'); END IF;
  IF p_key NOT IN ('coach', 'bienveillant', 'pote_hype', 'fashion_week', 'streetwear') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Personnalité invalide');
  END IF;

  SELECT (has_analysis_pass OR has_ootd_plus_pass) INTO v_has_legacy
    FROM profiles WHERE id = v_uid;

  SELECT plan_type INTO v_plan
    FROM subscriptions
   WHERE user_id = v_uid AND status IN ('active', 'trialing')
   ORDER BY (plan_type = 'elite') DESC, current_period_end DESC NULLS LAST
   LIMIT 1;

  v_tier := CASE
    WHEN v_plan = 'elite' THEN 'elite'
    WHEN v_plan = 'plus' OR v_has_legacy THEN 'plus'
    ELSE 'free'
  END;

  v_required := CASE p_key
    WHEN 'bienveillant'  THEN 'plus'
    WHEN 'pote_hype'     THEN 'elite'
    WHEN 'fashion_week'  THEN 'elite'
    WHEN 'streetwear'    THEN 'elite'
    ELSE 'free'
  END;

  IF (v_required = 'plus' AND v_tier = 'free')
     OR (v_required = 'elite' AND v_tier <> 'elite') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Personnalité verrouillée pour ton offre actuelle');
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE profiles SET analysis_personality = p_key WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.set_analysis_personality(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_analysis_personality(text) TO authenticated;

-- ===========================================================================
-- 4. MOYENNE — is_elite(p_uid) n'avait jamais reçu de REVOKE (donc appelable
--    par anon) et acceptait n'importe quel p_uid : n'importe qui pouvait
--    interroger le statut Elite de n'importe quel autre utilisateur. Tous
--    les appels internes existants (buy_cosmetic/equip_cosmetic/
--    claim_monthly_freezes) ne l'appellent déjà qu'avec auth.uid() du
--    contexte courant — la restriction p_uid = auth.uid() ne change donc
--    rien pour eux, juste ferme la fuite pour un appel RPC direct externe.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.is_elite(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_uid = auth.uid() AND EXISTS (
    SELECT 1 FROM subscriptions
     WHERE user_id = p_uid AND status IN ('active', 'trialing') AND plan_type = 'elite'
  );
$$;
REVOKE ALL ON FUNCTION public.is_elite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_elite(uuid) TO authenticated;

-- ===========================================================================
-- 5. MOYENNE — hygiène GRANT/REVOKE : ces RPCs (toutes antérieures à la
--    convention REVOKE+GRANT établie depuis le 2026-05-31 sur les fonctions
--    Stripe, puis systématisée sur tout le lot Compétitions v2) n'avaient
--    jamais reçu de REVOKE ALL FROM PUBLIC — appelables par anon (chacune
--    vérifie déjà auth.uid() en interne et échoue proprement pour anon,
--    donc pas d'escalade de privilège possible aujourd'hui, mais surface
--    de sondage/DoS anonyme inutile et incohérente avec le reste du projet).
-- ===========================================================================

REVOKE ALL ON FUNCTION consume_daily_credit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_daily_credit(uuid) TO authenticated;

REVOKE ALL ON FUNCTION award_points_for_ootd(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION award_points_for_ootd(uuid) TO authenticated;

REVOKE ALL ON FUNCTION buy_pass(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buy_pass(text) TO authenticated;

REVOKE ALL ON FUNCTION buy_cosmetic(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buy_cosmetic(text, text) TO authenticated;

REVOKE ALL ON FUNCTION equip_cosmetic(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION equip_cosmetic(text, text) TO authenticated;

REVOKE ALL ON FUNCTION buy_pass_24h() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buy_pass_24h() TO authenticated;

REVOKE ALL ON FUNCTION buy_flame_freeze() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buy_flame_freeze() TO authenticated;

REVOKE ALL ON FUNCTION use_flame_freeze() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION use_flame_freeze() TO authenticated;

REVOKE ALL ON FUNCTION public.restore_flamme(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_flamme(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_monthly_freezes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_monthly_freezes() TO authenticated;

REVOKE ALL ON FUNCTION toggle_message_like(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION toggle_message_like(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION delete_message(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_message(uuid) TO authenticated;

REVOKE ALL ON FUNCTION mark_messages_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_messages_read(uuid) TO authenticated;

REVOKE ALL ON FUNCTION increment_style_stats(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_style_stats(text[]) TO authenticated;

REVOKE ALL ON FUNCTION check_analyze_rate_limit(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_analyze_rate_limit(integer) TO authenticated;

-- ===========================================================================
-- 6. BASSE — flammes_mutate_involved (FOR ALL) laissait les deux parties
--    réécrire librement streak/last_snap_at par UPDATE direct, contournant
--    l'économie de gels de flamme (restore_flamme). Fonctionnalité déjà
--    morte (FlammesScreen.js supprimé, plus aucun écran ne lit/écrit cette
--    table — voir 20260925120000_competition_streak.sql) : on retire
--    simplement la capacité d'écriture client, flammes_select_involved
--    (déjà existante) reste pour ne rien casser côté historique éventuel.
-- ===========================================================================

DROP POLICY IF EXISTS "flammes_mutate_involved" ON public.flammes;

NOTIFY pgrst, 'reload schema';
