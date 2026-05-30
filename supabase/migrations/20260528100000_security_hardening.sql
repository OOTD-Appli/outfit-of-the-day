-- OOTD — Durcissement sécurité (audit 2026-05-28)
-- Couvre SEC-01 à SEC-08 de TACHES.md
-- À exécuter dans SQL Editor Supabase (ou `supabase db push`).

-- ===========================================================================
-- 1. Helper : compute_niveau (miroir de lib/utils.js#computeNiveau)
-- ===========================================================================

CREATE OR REPLACE FUNCTION compute_niveau(p_pts integer)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_level      integer := 1;
  v_threshold  integer := 100;
  v_cumulative integer := 0;
BEGIN
  WHILE v_cumulative + v_threshold <= p_pts LOOP
    v_cumulative := v_cumulative + v_threshold;
    v_level      := v_level + 1;
    v_threshold  := FLOOR(v_threshold * 1.8);
  END LOOP;
  RETURN v_level;
END;
$$;

-- ===========================================================================
-- 2. Trigger : protection des colonnes sensibles de profiles
--    Toute UPDATE directe depuis le client sur ces colonnes est silencieusement
--    annulée. Seules les RPCs SECURITY DEFINER peuvent les modifier en
--    positionnant le flag de session `app.bypass_profile_guard = 'on'`.
-- ===========================================================================

CREATE OR REPLACE FUNCTION profiles_guard_sensitive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Les RPCs de confiance positionnent ce flag (LOCAL = limité à la transaction)
  IF coalesce(current_setting('app.bypass_profile_guard', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  -- Colonnes financières / de progression : reset silencieux
  NEW.points             := OLD.points;
  NEW.niveau             := OLD.niveau;
  NEW.has_analysis_pass  := OLD.has_analysis_pass;
  NEW.has_ootd_plus_pass := OLD.has_ootd_plus_pass;
  NEW.daily_credits      := OLD.daily_credits;
  NEW.credits_reset_date := OLD.credits_reset_date;
  NEW.unlocked_themes    := OLD.unlocked_themes;
  NEW.unlocked_logos     := OLD.unlocked_logos;
  -- Cosmétiques : empêche d'équiper un article non possédé
  NEW.active_theme       := OLD.active_theme;
  NEW.active_logo        := OLD.active_logo;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_sensitive_trigger ON public.profiles;
CREATE TRIGGER profiles_guard_sensitive_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_guard_sensitive();

-- ===========================================================================
-- 3. Mise à jour de consume_daily_credit : ajouter le bypass
-- ===========================================================================

CREATE OR REPLACE FUNCTION consume_daily_credit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits      integer;
  v_reset_date   date;
  v_has_pass     boolean;
  v_max          integer;
  v_today        date := CURRENT_DATE;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Accès refusé');
  END IF;

  SELECT daily_credits,
         credits_reset_date,
         (has_analysis_pass OR has_ootd_plus_pass)
    INTO v_credits, v_reset_date, v_has_pass
    FROM profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
  END IF;

  v_max := CASE WHEN v_has_pass THEN 20 ELSE 2 END;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  IF v_reset_date < v_today THEN
    v_credits := v_max;
    UPDATE profiles
       SET daily_credits = v_max, credits_reset_date = v_today
     WHERE id = p_user_id;
  END IF;

  IF v_credits <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Plus d''analyses disponibles aujourd''hui',
      'credits', 0,
      'max_credits', v_max
    );
  END IF;

  UPDATE profiles SET daily_credits = daily_credits - 1 WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'credits', v_credits - 1,
    'max_credits', v_max
  );
END;
$$;

-- ===========================================================================
-- 4. RPC : award_points_for_ootd
--    Lit le score réel depuis la DB, calcule et attribue points + niveau.
-- ===========================================================================

CREATE OR REPLACE FUNCTION award_points_for_ootd(p_ootd_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score         numeric;
  v_points_earned integer;
  v_new_points    integer;
  v_new_niveau    integer;
BEGIN
  -- Vérification propriété + récupération du score
  SELECT score_global INTO v_score
    FROM ootds
   WHERE id = p_ootd_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OOTD introuvable ou non autorisé');
  END IF;

  -- Clampe le score 1-10 même si l'insert client a triché
  v_score         := LEAST(GREATEST(v_score, 1), 10);
  v_points_earned := ROUND(v_score * 3);

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  UPDATE profiles
     SET points = GREATEST(points + v_points_earned, 0)
   WHERE id = auth.uid()
  RETURNING points INTO v_new_points;

  v_new_niveau := compute_niveau(v_new_points);

  UPDATE profiles SET niveau = v_new_niveau WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'ok',           true,
    'points_earned', v_points_earned,
    'new_points',   v_new_points,
    'new_niveau',   v_new_niveau
  );
END;
$$;

-- ===========================================================================
-- 5. RPC : buy_pass
-- ===========================================================================

CREATE OR REPLACE FUNCTION buy_pass(pass_type text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid    := auth.uid();
  v_prof       profiles%ROWTYPE;
  v_cost       integer;
  v_is_plus    boolean;
  v_all_themes text[]  := ARRAY['default','midnight','emerald','gold','sakura'];
  v_all_logos  text[]  := ARRAY['default','diamond','crown','fire','star'];
BEGIN
  IF pass_type NOT IN ('analysis', 'ootdplus') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Type de pass invalide');
  END IF;

  v_cost    := CASE pass_type WHEN 'ootdplus' THEN 500 ELSE 400 END;
  v_is_plus := (pass_type = 'ootdplus');

  SELECT * INTO v_prof FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
  END IF;

  IF (v_is_plus AND v_prof.has_ootd_plus_pass) OR (NOT v_is_plus AND v_prof.has_analysis_pass) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tu possèdes déjà ce pass');
  END IF;

  IF v_prof.points < v_cost THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Points insuffisants',
      'points', v_prof.points,
      'required', v_cost
    );
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  IF v_is_plus THEN
    UPDATE profiles SET
      has_ootd_plus_pass  = true,
      points              = points - v_cost,
      daily_credits       = 20,
      credits_reset_date  = CURRENT_DATE,
      unlocked_themes     = v_all_themes,
      unlocked_logos      = v_all_logos
    WHERE id = v_uid;
  ELSE
    UPDATE profiles SET
      has_analysis_pass  = true,
      points             = points - v_cost,
      daily_credits      = 20,
      credits_reset_date = CURRENT_DATE
    WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_points', v_prof.points - v_cost);
END;
$$;

-- ===========================================================================
-- 6. RPC : buy_cosmetic
-- ===========================================================================

CREATE OR REPLACE FUNCTION buy_cosmetic(item_type text, item_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid   := auth.uid();
  v_prof         profiles%ROWTYPE;
  v_price        integer;
  v_current      text[];
  v_valid_themes text[] := ARRAY['default','midnight','emerald','gold','sakura'];
  v_valid_logos  text[] := ARRAY['default','diamond','crown','fire','star'];
BEGIN
  IF item_type NOT IN ('theme', 'logo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Type invalide');
  END IF;
  IF item_type = 'theme' AND NOT (item_id = ANY(v_valid_themes)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Thème invalide');
  END IF;
  IF item_type = 'logo' AND NOT (item_id = ANY(v_valid_logos)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Logo invalide');
  END IF;

  v_price := CASE item_type WHEN 'theme' THEN 200 ELSE 100 END;

  SELECT * INTO v_prof FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
  END IF;

  v_current := CASE item_type WHEN 'theme' THEN v_prof.unlocked_themes ELSE v_prof.unlocked_logos END;

  IF item_id = ANY(v_current) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Déjà dans ta collection');
  END IF;
  IF v_prof.points < v_price THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Points insuffisants',
      'points', v_prof.points,
      'required', v_price
    );
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  IF item_type = 'theme' THEN
    UPDATE profiles SET
      points          = points - v_price,
      unlocked_themes = array_append(unlocked_themes, item_id)
    WHERE id = v_uid;
  ELSE
    UPDATE profiles SET
      points         = points - v_price,
      unlocked_logos = array_append(unlocked_logos, item_id)
    WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_points', v_prof.points - v_price);
END;
$$;

-- ===========================================================================
-- 7. RPC : equip_cosmetic  (valide que l'article est possédé avant d'équiper)
-- ===========================================================================

CREATE OR REPLACE FUNCTION equip_cosmetic(item_type text, item_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_owned        boolean;
  v_valid_themes text[] := ARRAY['default','midnight','emerald','gold','sakura'];
  v_valid_logos  text[] := ARRAY['default','diamond','crown','fire','star'];
BEGIN
  IF item_type NOT IN ('theme', 'logo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Type invalide');
  END IF;
  IF item_type = 'theme' AND NOT (item_id = ANY(v_valid_themes)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Thème invalide');
  END IF;
  IF item_type = 'logo' AND NOT (item_id = ANY(v_valid_logos)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Logo invalide');
  END IF;

  IF item_id = 'default' THEN
    v_owned := true;
  ELSE
    SELECT CASE item_type
      WHEN 'theme' THEN (item_id = ANY(unlocked_themes) OR has_ootd_plus_pass)
      ELSE               (item_id = ANY(unlocked_logos)  OR has_ootd_plus_pass)
    END INTO v_owned
    FROM profiles WHERE id = v_uid;
  END IF;

  IF NOT coalesce(v_owned, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Article non possédé');
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  IF item_type = 'theme' THEN
    UPDATE profiles SET active_theme = item_id WHERE id = v_uid;
  ELSE
    UPDATE profiles SET active_logo  = item_id WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ===========================================================================
-- 8. Friendships : policies scindées par direction (SEC-04)
-- ===========================================================================

DROP POLICY IF EXISTS "friendships_mutate_involved" ON public.friendships;
DROP POLICY IF EXISTS "friendships_insert_requester" ON public.friendships;
DROP POLICY IF EXISTS "friendships_update_recipient" ON public.friendships;
DROP POLICY IF EXISTS "friendships_delete_involved"  ON public.friendships;

-- Le demandeur crée la ligne en tant que user_id (status = pending obligatoire)
CREATE POLICY "friendships_insert_requester"
  ON public.friendships FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = 'pending'
  );

-- Le destinataire accepte ou refuse (status courant doit être pending)
CREATE POLICY "friendships_update_recipient"
  ON public.friendships FOR UPDATE
  TO authenticated
  USING (
    friend_id = (SELECT auth.uid())
    AND status = 'pending'
  )
  WITH CHECK (
    friend_id = (SELECT auth.uid())
    AND status IN ('accepted', 'declined')
  );

-- Les deux parties peuvent supprimer (annulation / refus par suppression)
CREATE POLICY "friendships_delete_involved"
  ON public.friendships FOR DELETE
  TO authenticated
  USING (
    user_id  = (SELECT auth.uid())
    OR friend_id = (SELECT auth.uid())
  );

-- ===========================================================================
-- 9. Messages : check amitié acceptée sur INSERT (SEC-05)
-- ===========================================================================

DROP POLICY IF EXISTS "Users send messages" ON public.messages;
CREATE POLICY "Users send messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.user_id  = (SELECT auth.uid()) AND f.friend_id = receiver_id)
          OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = receiver_id)
        )
    )
  );

-- ===========================================================================
-- 10. Snaps : check amitié acceptée sur INSERT (SEC-05)
-- ===========================================================================

DROP POLICY IF EXISTS "snaps_insert_sender" ON public.snaps;
CREATE POLICY "snaps_insert_sender"
  ON public.snaps FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.user_id  = (SELECT auth.uid()) AND f.friend_id = receiver_id)
          OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = receiver_id)
        )
    )
  );

-- ===========================================================================
-- 11. Storage stories : restreindre l'upload au chemin <uid>/… (SEC-06)
-- ===========================================================================

DROP POLICY IF EXISTS "Authenticated can upload stories" ON storage.objects;
CREATE POLICY "Authenticated can upload stories"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'stories'
    AND split_part(name, '/', 1) = (SELECT auth.uid()::text)
  );

-- ===========================================================================
-- 12. Stories : visibles uniquement par l'auteur ou un ami accepté (SEC-08)
-- ===========================================================================

DROP POLICY IF EXISTS "Anyone authenticated can see active stories" ON public.stories;
DROP POLICY IF EXISTS "stories_select_friends_only" ON public.stories;

CREATE POLICY "stories_select_friends_only"
  ON public.stories FOR SELECT
  TO authenticated
  USING (
    expires_at > now()
    AND (
      user_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.friendships f
        WHERE f.status = 'accepted'
          AND (
            (f.user_id  = (SELECT auth.uid()) AND f.friend_id = stories.user_id)
            OR (f.friend_id = (SELECT auth.uid()) AND f.user_id = stories.user_id)
          )
      )
    )
  );
