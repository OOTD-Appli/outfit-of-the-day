-- OOTD — Refonte de la boutique points (2026-05-31)
-- 1. Cosmétiques : prix par rareté (thèmes 250/400, logos 100/200/500).
-- 2. Nouveaux consommables points :
--      * Pass Analyse 24h (150 pts) : 20 analyses pour la journée en cours.
--      * Gel de Flamme   (300 pts) : préserve une série de flammes lors d'un oubli.
--
-- Sécurité : tous les prix restent appliqués CÔTÉ SERVEUR (le client n'envoie
-- jamais de montant). Les colonnes financières sont protégées par le trigger
-- profiles_guard_sensitive ; seules ces RPC SECURITY DEFINER les modifient.

-- ===========================================================================
-- 1. Colonne flame_freezes (stock de Gels de Flamme possédés)
-- ===========================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS flame_freezes integer NOT NULL DEFAULT 0;

-- ===========================================================================
-- 2. Garde sensible : protège aussi flame_freezes contre l'écriture client
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

  NEW.points             := OLD.points;
  NEW.niveau             := OLD.niveau;
  NEW.has_analysis_pass  := OLD.has_analysis_pass;
  NEW.has_ootd_plus_pass := OLD.has_ootd_plus_pass;
  NEW.daily_credits      := OLD.daily_credits;
  NEW.credits_reset_date := OLD.credits_reset_date;
  NEW.unlocked_themes    := OLD.unlocked_themes;
  NEW.unlocked_logos     := OLD.unlocked_logos;
  NEW.active_theme       := OLD.active_theme;
  NEW.active_logo        := OLD.active_logo;
  NEW.flame_freezes      := OLD.flame_freezes;

  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 3. buy_cosmetic v2 : prix par rareté (au lieu du forfait 200/100)
--    Thèmes : gold / sakura = 400 · autres = 250
--    Logos  : crown = 500 · diamond / star = 200 · autres (fire) = 100
--    (le thème/logo 'default' est gratuit et déjà possédé → jamais acheté ici)
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

  -- Prix par rareté, défini côté serveur (autorité unique sur les montants)
  v_price := CASE
    WHEN item_type = 'theme' THEN
      CASE WHEN item_id IN ('gold', 'sakura') THEN 400 ELSE 250 END
    ELSE
      CASE item_id WHEN 'crown' THEN 500 WHEN 'diamond' THEN 200 WHEN 'star' THEN 200 ELSE 100 END
  END;

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
-- 4. buy_pass_24h : Pass Analyse 24h (150 pts → 20 analyses aujourd'hui)
--    Boost temporaire : ne pose PAS has_analysis_pass (qui est permanent),
--    il fixe juste les crédits du jour à 20. Demain, reset au palier normal.
-- ===========================================================================

CREATE OR REPLACE FUNCTION buy_pass_24h()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_prof profiles%ROWTYPE;
  v_cost integer := 150;
BEGIN
  SELECT * INTO v_prof FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
  END IF;

  -- Déjà au plafond aujourd'hui (pass/abonnement ou 24h déjà acheté) : inutile
  IF v_prof.credits_reset_date = CURRENT_DATE AND v_prof.daily_credits >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Tu as déjà 20 analyses aujourd''hui');
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

  UPDATE profiles SET
    points             = points - v_cost,
    daily_credits      = 20,
    credits_reset_date = CURRENT_DATE
  WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'new_points', v_prof.points - v_cost, 'credits', 20);
END;
$$;

-- ===========================================================================
-- 5. buy_flame_freeze : achète un Gel de Flamme (300 pts → +1 en stock)
-- ===========================================================================

CREATE OR REPLACE FUNCTION buy_flame_freeze()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_prof profiles%ROWTYPE;
  v_cost integer := 300;
BEGIN
  SELECT * INTO v_prof FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
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

  UPDATE profiles SET
    points        = points - v_cost,
    flame_freezes = flame_freezes + 1
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'new_points', v_prof.points - v_cost,
    'flame_freezes', v_prof.flame_freezes + 1
  );
END;
$$;

-- ===========================================================================
-- 6. use_flame_freeze : consomme un Gel de Flamme (appelé quand une série
--    serait brisée). Renvoie ok=false si l'utilisateur n'en a aucun.
-- ===========================================================================

CREATE OR REPLACE FUNCTION use_flame_freeze()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_count integer;
BEGIN
  SELECT flame_freezes INTO v_count FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
  END IF;
  IF coalesce(v_count, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Aucun Gel de Flamme disponible');
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  UPDATE profiles SET flame_freezes = flame_freezes - 1 WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'flame_freezes', v_count - 1);
END;
$$;
