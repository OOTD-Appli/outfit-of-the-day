-- OOTD — Rate-limit applicatif Edge Function (SEC-16)
-- Limite les appels à analyze-outfit à MAX_PER_MINUTE requêtes/minute/utilisateur,
-- indépendamment des crédits journaliers (protection contre la manipulation de crédits).

CREATE TABLE IF NOT EXISTS public.analyze_rate_limit (
  user_id      uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL DEFAULT now(),
  req_count    integer     NOT NULL DEFAULT 0
);

ALTER TABLE public.analyze_rate_limit ENABLE ROW LEVEL SECURITY;
-- Aucune policy : seul le service_role et les SECURITY DEFINER y accèdent.

-- RPC atomique appelée par l'Edge Function (via le client authentifié de l'utilisateur).
-- Retourne true si la requête est autorisée, false si le rate-limit est atteint.
CREATE OR REPLACE FUNCTION check_analyze_rate_limit(p_max_per_minute integer DEFAULT 5)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid        := auth.uid();
  v_now         timestamptz := now();
  v_win_start   timestamptz;
  v_count       integer;
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT window_start, req_count
    INTO v_win_start, v_count
    FROM analyze_rate_limit
   WHERE user_id = v_uid
     FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO analyze_rate_limit (user_id, window_start, req_count)
    VALUES (v_uid, v_now, 1);
    RETURN true;
  END IF;

  -- Fenêtre expirée → réinitialisation
  IF v_win_start < v_now - interval '1 minute' THEN
    UPDATE analyze_rate_limit
       SET window_start = v_now, req_count = 1
     WHERE user_id = v_uid;
    RETURN true;
  END IF;

  -- Fenêtre active : vérifier le plafond
  IF v_count >= p_max_per_minute THEN
    RETURN false;
  END IF;

  UPDATE analyze_rate_limit SET req_count = req_count + 1 WHERE user_id = v_uid;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION check_analyze_rate_limit(integer) TO authenticated;
