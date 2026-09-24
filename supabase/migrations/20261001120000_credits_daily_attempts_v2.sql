-- OOTD — Pricing final v2 : tentatives quotidiennes (2026-09-23, décidé avec Médi)
-- Voir Output/2026-09-23_pricing-final-tentatives-quotidiennes.md
--
-- Nouveaux plafonds quotidiens de consume_daily_credit :
--   Gratuit 1 (au lieu de 2) · Plus 2 (au lieu de 20) · Elite 5 (au lieu d'illimité)
--
-- Point de garde-fou explicite (Output/2026-09-23_prompt-claude-code-shop-perks-final.md) :
-- Elite reste PLAFONNÉ à 5, jamais illimité — avec le nouveau système où chaque
-- retentative efface le résultat précédent, un plafond illimité recréerait le
-- pay-to-win (retenter à l'infini jusqu'à un score quasi parfait). L'ancienne
-- sentinelle "credits=-1/max_credits=-1/unlimited=true" (retour anticipé pour
-- Elite) est donc retirée : Elite passe par exactement la même logique de
-- décrément que free/plus, juste avec un plafond plus généreux.

CREATE OR REPLACE FUNCTION consume_daily_credit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits    integer;
  v_reset_date date;
  v_has_legacy boolean;
  v_plan       text;
  v_tier       text;
  v_max        integer;
  v_today      date := CURRENT_DATE;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Accès refusé');
  END IF;

  SELECT daily_credits,
         credits_reset_date,
         (has_analysis_pass OR has_ootd_plus_pass)
    INTO v_credits, v_reset_date, v_has_legacy
    FROM profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
  END IF;

  -- Abonnement Stripe actif le plus avantageux
  SELECT plan_type INTO v_plan
    FROM subscriptions
   WHERE user_id = p_user_id
     AND status IN ('active', 'trialing')
   ORDER BY (plan_type = 'elite') DESC, current_period_end DESC NULLS LAST
   LIMIT 1;

  v_tier := CASE
    WHEN v_plan = 'elite' THEN 'elite'
    WHEN v_plan = 'plus' OR v_has_legacy THEN 'plus'
    ELSE 'free'
  END;

  -- Plafond quotidien : Elite plafonné (pas de sentinelle "illimité") — voir
  -- garde-fou anti pay-to-win en tête de fichier.
  v_max := CASE v_tier
    WHEN 'elite' THEN 5
    WHEN 'plus'  THEN 2
    ELSE 1
  END;

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
      'error', 'Plus de tentatives disponibles aujourd''hui',
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

-- Pas de REVOKE/GRANT : signature (uuid) inchangée, CREATE OR REPLACE conserve
-- les privilèges déjà accordés.
