-- Système de crédits d'analyse quotidiens (freemium)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS daily_credits integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS credits_reset_date date NOT NULL DEFAULT CURRENT_DATE;

-- Fonction atomique : reset si nouveau jour + vérification + décrémentation
-- SECURITY DEFINER : tourne avec les droits postgres pour bypasser le RLS sur UPDATE.
-- La vérification auth.uid() = p_user_id empêche qu'un utilisateur consomme les crédits d'un autre.
CREATE OR REPLACE FUNCTION consume_daily_credit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits        integer;
  v_reset_date     date;
  v_today          date := CURRENT_DATE;
BEGIN
  -- Vérifie que l'appelant est bien le propriétaire
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Accès refusé');
  END IF;

  -- Verrouille la ligne pour éviter les race conditions
  SELECT daily_credits, credits_reset_date
    INTO v_credits, v_reset_date
    FROM profiles
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
  END IF;

  -- Reset automatique si un nouveau jour a commencé
  IF v_reset_date < v_today THEN
    v_credits := 2;
    UPDATE profiles
       SET daily_credits = 2, credits_reset_date = v_today
     WHERE id = p_user_id;
  END IF;

  -- Crédits épuisés
  IF v_credits <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Plus d''analyses disponibles aujourd''hui', 'credits', 0);
  END IF;

  -- Décrémente et retourne le solde restant après consommation
  UPDATE profiles
     SET daily_credits = daily_credits - 1
   WHERE id = p_user_id;

  RETURN jsonb_build_object('ok', true, 'credits', v_credits - 1);
END;
$$;
