-- OOTD — Classements : moyenne (pas meilleur score) hors période "Jour" (2026-09-30)
-- Demande produit : get_top3_app/get_top3_friends/get_competition_leaderboard
-- utilisaient MAX(score_global) pour TOUTES les périodes — seule "Jour" doit
-- rester un record (meilleur score du jour), "Semaine"/"Mois"/"Toujours"
-- doivent refléter la régularité via une moyenne (ROUND(AVG(...), 1)), même
-- logique que le calcul déjà existant de most_improved dans
-- get_competition_leaderboard (qui moyennait déjà, mais uniquement pour son
-- propre usage interne — pas pour le "ranking" principal).
--
-- Colonne de sortie renommée best_score -> score dans les 3 fonctions : son
-- sens change selon la période (meilleur score pour Jour, moyenne pour les 3
-- autres) — un nom neutre évite la confusion côté client.

-- ===========================================================================
-- 1. get_competition_leaderboard — seul le "ranking" change (most_improved
--    faisait déjà une moyenne, most_regular/most_liked ne portent pas de
--    score_global agrégé). Retour jsonb inchangé (juste une clé renommée à
--    l'intérieur) : CREATE OR REPLACE suffit, pas de DROP nécessaire.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_competition_leaderboard(
  p_competition_id uuid,
  p_period         text DEFAULT 'week'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_local_now      timestamp;
  v_since          timestamptz;
  v_prev_since     timestamptz;
  v_prev_until     timestamptz;
  v_ranking        jsonb;
  v_most_regular   jsonb;
  v_most_improved  jsonb;
  v_most_liked     jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM competition_members cm
    WHERE cm.competition_id = p_competition_id AND cm.user_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non membre');
  END IF;

  v_local_now := (now() AT TIME ZONE 'Europe/Paris');

  v_since := CASE p_period
    WHEN 'day'   THEN (date_trunc('day', v_local_now)) AT TIME ZONE 'Europe/Paris'
    WHEN 'week'  THEN (date_trunc('week', v_local_now)) AT TIME ZONE 'Europe/Paris'
    WHEN 'month' THEN (date_trunc('month', v_local_now)) AT TIME ZONE 'Europe/Paris'
    ELSE '-infinity'::timestamptz
  END;

  v_prev_until := v_since;
  v_prev_since := CASE p_period
    WHEN 'week'  THEN (date_trunc('week', v_local_now - interval '1 week')) AT TIME ZONE 'Europe/Paris'
    WHEN 'month' THEN (date_trunc('month', v_local_now - interval '1 month')) AT TIME ZONE 'Europe/Paris'
    ELSE '-infinity'::timestamptz
  END;

  -- Jour = record du jour (MAX) ; Semaine/Mois/Toujours = régularité (AVG).
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', cm.user_id,
        'username', p.username,
        'avatar_url', p.avatar_url,
        'score', best.score,
        'streak_count', cm.streak_count
      )
      ORDER BY best.score DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_ranking
  FROM competition_members cm
  JOIN profiles p ON p.id = cm.user_id
  LEFT JOIN (
    SELECT oc.user_id,
      CASE WHEN p_period = 'day' THEN MAX(o.score_global) ELSE ROUND(AVG(o.score_global), 1) END AS score
    FROM ootd_competitions oc
    JOIN ootds o ON o.id = oc.ootd_id
    WHERE oc.competition_id = p_competition_id
      AND o.created_at >= v_since
    GROUP BY oc.user_id
  ) best ON best.user_id = cm.user_id
  WHERE cm.competition_id = p_competition_id;

  SELECT jsonb_build_object(
    'user_id', cm.user_id,
    'username', p.username,
    'avatar_url', p.avatar_url,
    'streak_count', cm.streak_count
  )
  INTO v_most_regular
  FROM competition_members cm
  JOIN profiles p ON p.id = cm.user_id
  WHERE cm.competition_id = p_competition_id AND cm.streak_count > 0
  ORDER BY cm.streak_count DESC
  LIMIT 1;

  WITH cur AS (
    SELECT oc.user_id, AVG(o.score_global) AS avg_score
    FROM ootd_competitions oc
    JOIN ootds o ON o.id = oc.ootd_id
    WHERE oc.competition_id = p_competition_id
      AND o.created_at >= v_since
    GROUP BY oc.user_id
  ),
  prev AS (
    SELECT oc.user_id, AVG(o.score_global) AS avg_score
    FROM ootd_competitions oc
    JOIN ootds o ON o.id = oc.ootd_id
    WHERE oc.competition_id = p_competition_id
      AND o.created_at >= v_prev_since
      AND o.created_at < v_prev_until
    GROUP BY oc.user_id
  )
  SELECT jsonb_build_object(
    'user_id', cur.user_id,
    'username', p.username,
    'avatar_url', p.avatar_url,
    'delta', round(cur.avg_score - prev.avg_score, 1)
  )
  INTO v_most_improved
  FROM cur
  JOIN prev ON prev.user_id = cur.user_id
  JOIN profiles p ON p.id = cur.user_id
  ORDER BY (cur.avg_score - prev.avg_score) DESC
  LIMIT 1;

  SELECT jsonb_build_object(
    'ootd_id', o.id,
    'user_id', o.user_id,
    'username', p.username,
    'image_url', o.image_url,
    'like_count', coalesce(lc.like_count, 0)
  )
  INTO v_most_liked
  FROM ootd_competitions oc
  JOIN ootds o ON o.id = oc.ootd_id
  JOIN profiles p ON p.id = o.user_id
  LEFT JOIN (
    SELECT ootd_id, COUNT(*) AS like_count FROM likes GROUP BY ootd_id
  ) lc ON lc.ootd_id = o.id
  WHERE oc.competition_id = p_competition_id
    AND o.created_at >= v_since
  ORDER BY coalesce(lc.like_count, 0) DESC, o.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'ranking', v_ranking,
    'most_regular', v_most_regular,
    'most_improved', v_most_improved,
    'most_liked', v_most_liked
  );
END;
$$;

-- Pas de REVOKE/GRANT ici : signature (uuid, text) inchangée, CREATE OR
-- REPLACE conserve les privilèges déjà accordés.

-- ===========================================================================
-- 2. get_top3_app / get_top3_friends — colonne de sortie renommée
--    (best_score -> score) : Postgres refuse un CREATE OR REPLACE qui change
--    les colonnes d'un RETURNS TABLE(...), un DROP préalable est donc
--    obligatoire ici (pas juste une précaution de cache PostgREST).
-- ===========================================================================

DROP FUNCTION IF EXISTS public.get_top3_app(text);
DROP FUNCTION IF EXISTS public.get_top3_friends(text);

CREATE OR REPLACE FUNCTION public.get_top3_app(p_period text DEFAULT 'week')
RETURNS TABLE(user_id uuid, username text, avatar_url text, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH bounds AS (
    SELECT CASE p_period
      WHEN 'day'   THEN date_trunc('day', (now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris'
      WHEN 'week'  THEN date_trunc('week', (now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris'
      WHEN 'month' THEN date_trunc('month', (now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris'
      ELSE '-infinity'::timestamptz
    END AS start_at
  )
  SELECT o.user_id, p.username, p.avatar_url,
    CASE WHEN p_period = 'day' THEN MAX(o.score_global) ELSE ROUND(AVG(o.score_global), 1) END AS score
  FROM public.ootds o
  JOIN public.profiles p ON p.id = o.user_id
  CROSS JOIN bounds
  WHERE o.created_at >= bounds.start_at
    AND o.is_public = true
    AND p.is_private = false
  GROUP BY o.user_id, p.username, p.avatar_url
  ORDER BY score DESC
  LIMIT 3;
$$;
REVOKE ALL ON FUNCTION public.get_top3_app(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top3_app(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_top3_friends(p_period text DEFAULT 'week')
RETURNS TABLE(user_id uuid, username text, avatar_url text, score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH my_friends AS (
    SELECT friend_id AS uid FROM public.friendships WHERE user_id = auth.uid() AND status = 'accepted'
    UNION
    SELECT user_id AS uid FROM public.friendships WHERE friend_id = auth.uid() AND status = 'accepted'
  ),
  bounds AS (
    SELECT CASE p_period
      WHEN 'day'   THEN date_trunc('day', (now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris'
      WHEN 'week'  THEN date_trunc('week', (now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris'
      WHEN 'month' THEN date_trunc('month', (now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris'
      ELSE '-infinity'::timestamptz
    END AS start_at
  )
  SELECT o.user_id, p.username, p.avatar_url,
    CASE WHEN p_period = 'day' THEN MAX(o.score_global) ELSE ROUND(AVG(o.score_global), 1) END AS score
  FROM public.ootds o
  JOIN public.profiles p ON p.id = o.user_id
  CROSS JOIN bounds
  WHERE o.user_id IN (SELECT uid FROM my_friends)
    AND o.created_at >= bounds.start_at
    AND o.is_public = true
  GROUP BY o.user_id, p.username, p.avatar_url
  ORDER BY score DESC
  LIMIT 3;
$$;
REVOKE ALL ON FUNCTION public.get_top3_friends(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top3_friends(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
