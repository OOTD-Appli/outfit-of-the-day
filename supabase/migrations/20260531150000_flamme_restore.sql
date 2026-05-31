-- OOTD — Flammes : restauration par Gel + distribution mensuelle (2026-05-31)
-- 1. Restauration d'une flamme éteinte via un Gel de Flamme (fenêtre 48h).
-- 2. Distribution mensuelle automatique de gels (Free 1 / Elite 2) — claim paresseux.
--
-- Règle d'expiration (dérivée de flammes.last_snap_at) :
--   âge <= 24h        → flamme active
--   24h < âge <= 72h  → éteinte mais restaurable (fenêtre de 48h)
--   âge > 72h         → définitivement perdue (retombe à 0)

-- ===========================================================================
-- 1. Colonne last_freeze_grant (dernier mois où des gels gratuits ont été versés)
-- ===========================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS last_freeze_grant date;

-- ===========================================================================
-- 2. Garde sensible : protège aussi last_freeze_grant
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
  NEW.last_freeze_grant  := OLD.last_freeze_grant;

  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 3. restore_flamme : consomme 1 gel et ranime la flamme (fenêtre 24h–72h)
--    SECURITY DEFINER : peut écrire flammes (hors RLS) + flame_freezes (guard).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.restore_flamme(p_flamme_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_flamme  flammes%ROWTYPE;
  v_age     double precision;
  v_freezes integer;
BEGIN
  SELECT * INTO v_flamme FROM flammes WHERE id = p_flamme_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Flamme introuvable');
  END IF;
  IF v_uid IS DISTINCT FROM v_flamme.user1_id AND v_uid IS DISTINCT FROM v_flamme.user2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Accès refusé');
  END IF;
  IF v_flamme.last_snap_at IS NULL OR coalesce(v_flamme.streak, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Rien à restaurer');
  END IF;

  v_age := EXTRACT(EPOCH FROM (now() - v_flamme.last_snap_at));
  IF v_age <= 86400 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_expired');
  END IF;
  IF v_age > 259200 THEN  -- 72h : fenêtre de restauration fermée
    RETURN jsonb_build_object('ok', false, 'error', 'window_closed');
  END IF;

  SELECT flame_freezes INTO v_freezes FROM profiles WHERE id = v_uid FOR UPDATE;
  IF coalesce(v_freezes, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_freeze');
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE profiles SET flame_freezes = flame_freezes - 1 WHERE id = v_uid;
  -- Ranime la flamme : on rafraîchit l'horodatage, le streak est conservé
  UPDATE flammes SET last_snap_at = now() WHERE id = p_flamme_id;

  RETURN jsonb_build_object('ok', true, 'streak', v_flamme.streak, 'flame_freezes', v_freezes - 1);
END;
$$;

-- ===========================================================================
-- 4. claim_monthly_freezes : verse les gels gratuits du mois (idempotent/mois)
--    Free = 1 · Elite = 2. Appelé au focus de l'app (Shop / Flammes).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.claim_monthly_freezes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_last        date;
  v_grant       integer;
  v_month_start date := date_trunc('month', CURRENT_DATE)::date;
BEGIN
  SELECT last_freeze_grant INTO v_last FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
  END IF;

  IF v_last IS NOT NULL AND v_last >= v_month_start THEN
    RETURN jsonb_build_object('ok', true, 'granted', 0);  -- déjà servi ce mois-ci
  END IF;

  v_grant := 1 + CASE WHEN public.is_elite(v_uid) THEN 1 ELSE 0 END;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE profiles
     SET flame_freezes     = flame_freezes + v_grant,
         last_freeze_grant = CURRENT_DATE
   WHERE id = v_uid;

  RETURN jsonb_build_object('ok', true, 'granted', v_grant);
END;
$$;
