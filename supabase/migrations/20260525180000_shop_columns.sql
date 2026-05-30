-- Shop : nouvelles colonnes profil pour le système de monétisation
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS has_analysis_pass  boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_ootd_plus_pass boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unlocked_themes    text[]    NOT NULL DEFAULT '{"default"}',
  ADD COLUMN IF NOT EXISTS unlocked_logos     text[]    NOT NULL DEFAULT '{"default"}',
  ADD COLUMN IF NOT EXISTS active_theme       text      NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS active_logo        text      NOT NULL DEFAULT 'default';

-- Mise à jour de consume_daily_credit :
-- reset à 20 crédits si l'utilisateur possède un pass, sinon 2
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

  -- Reset automatique au début d'un nouveau jour
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
