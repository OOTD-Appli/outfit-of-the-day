-- OOTD — Prompt IA v3 : note sur 100 + vérification photo complète (2026-09-21)
-- Deux changements côté base, tous deux nécessaires pour accompagner la
-- nouvelle échelle de score sans casser les données existantes.

-- 1. Marqueur d'échelle sur chaque ootd : les lignes déjà en base ont été
--    notées sur l'ancienne échelle (0-10 par critère, global = moyenne
--    arrondie des 3, donc 0-10). Sans ce marqueur, un futur écran de
--    progression "tout temps" mélangerait deux échelles incompatibles
--    (le classement hebdomadaire n'est lui pas concerné : les lignes
--    antérieures à cette migration sortent naturellement de la fenêtre
--    glissante "cette semaine").
ALTER TABLE public.ootds
  ADD COLUMN IF NOT EXISTS score_scale smallint NOT NULL DEFAULT 100;

UPDATE public.ootds SET score_scale = 10 WHERE created_at < now() AND score_scale = 100;

-- 2. award_points_for_ootd (20260528100000_security_hardening.sql) clampait
--    encore 1-10 et multipliait par 3 — avec un score v3 sur 100, ça aurait
--    plafonné tout le monde à 30 points fixes (LEAST(v_score,10)*3). Recalibré
--    pour garder le même plafond de points par publication (100*0.3 = 30,
--    identique à l'ancien 10*3) sans autre migration de l'économie de points.
CREATE OR REPLACE FUNCTION public.award_points_for_ootd(p_ootd_id uuid)
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
  SELECT score_global INTO v_score FROM ootds WHERE id = p_ootd_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OOTD introuvable ou non autorisé');
  END IF;

  v_score         := LEAST(GREATEST(v_score, 0), 100);
  v_points_earned := ROUND(v_score * 0.3);

  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE profiles SET points = GREATEST(points + v_points_earned, 0) WHERE id = auth.uid() RETURNING points INTO v_new_points;
  v_new_niveau := compute_niveau(v_new_points);
  UPDATE profiles SET niveau = v_new_niveau WHERE id = auth.uid();

  RETURN jsonb_build_object('ok', true, 'points_earned', v_points_earned, 'new_points', v_new_points, 'new_niveau', v_new_niveau);
END;
$$;
