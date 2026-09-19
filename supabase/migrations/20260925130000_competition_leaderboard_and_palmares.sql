-- OOTD — Classement par compétition + palmarès + période paramétrable (2026-09-25)
-- Implémente les décisions UX_DESIGN.md D1/D3/D5 :
--   D1. Un vrai classement PAR compétition (pas seulement le Top 3 global de
--       l'app) : get_competition_leaderboard() ci-dessous.
--   D3. Des blocs secondaires à côté du classement brut par score — régularité
--       (most_regular, basé sur le streak), progression (most_improved, moyenne
--       période courante vs période précédente) et coup de cœur (most_liked).
--   D5. Une période paramétrable (jour/semaine/mois/depuis toujours) plutôt que
--       le hebdomadaire figé actuel — appliqué ici ET rétrofité sur les deux
--       RPCs Top 3 existantes (get_top3_app/get_top3_friends) pour rester
--       cohérent dans toute l'app.
--
-- Dépendance : competition_members.streak_count et .last_submission_date sont
-- ajoutées par 20260925120000_competition_streak.sql (timestamp antérieur,
-- donc appliquée avant celle-ci par ordre alphabétique). On les référence sans
-- les recréer ici.

-- ===========================================================================
-- 1. get_competition_leaderboard — classement + palmarès d'UNE compétition
-- ===========================================================================
-- SECURITY DEFINER contourne le RLS de competition_members/ootd_competitions
-- (nécessaire pour agréger au-delà de ses propres lignes) : on doit donc
-- revérifier nous-mêmes l'appartenance à la compétition en tout premier, sinon
-- n'importe quel utilisateur authentifié pourrait lire le classement de
-- n'importe quelle compétition en devinant son id.

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

  -- "Maintenant" en heure locale Paris, calculé une seule fois : les
  -- arithmétiques de calendrier (- interval '1 week'/'1 month') sont ensuite
  -- faites sur ce timestamp "naïf" plutôt que sur un timestamptz, pour ne pas
  -- dépendre du TimeZone GUC de la session et rester correct autour des
  -- changements d'heure (DST) — même logique que date_trunc(..., Europe/Paris)
  -- déjà utilisée par get_top3_app/get_top3_friends.
  v_local_now := (now() AT TIME ZONE 'Europe/Paris');

  -- Début de la période courante.
  v_since := CASE p_period
    WHEN 'day'   THEN (date_trunc('day', v_local_now)) AT TIME ZONE 'Europe/Paris'
    WHEN 'week'  THEN (date_trunc('week', v_local_now)) AT TIME ZONE 'Europe/Paris'
    WHEN 'month' THEN (date_trunc('month', v_local_now)) AT TIME ZONE 'Europe/Paris'
    ELSE '-infinity'::timestamptz -- 'all' (ou toute valeur inconnue) = depuis toujours
  END;

  -- Bornes de la période précédente, de même durée, pour most_improved.
  -- 'day' et 'all' n'ont pas de "période précédente de même durée" au sens
  -- strict : on compare alors à TOUT ce qui précède v_since (borne -infinity),
  -- comme demandé par la spec.
  v_prev_until := v_since;
  v_prev_since := CASE p_period
    WHEN 'week'  THEN (date_trunc('week', v_local_now - interval '1 week')) AT TIME ZONE 'Europe/Paris'
    WHEN 'month' THEN (date_trunc('month', v_local_now - interval '1 month')) AT TIME ZONE 'Europe/Paris'
    ELSE '-infinity'::timestamptz
  END;

  -- --- ranking : un membre par ligne, y compris ceux sans soumission sur la
  -- période (LEFT JOIN -> best_score NULL), triés best_score DESC NULLS LAST.
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', cm.user_id,
        'username', p.username,
        'avatar_url', p.avatar_url,
        'best_score', best.best_score,
        'streak_count', cm.streak_count
      )
      ORDER BY best.best_score DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_ranking
  FROM competition_members cm
  JOIN profiles p ON p.id = cm.user_id
  LEFT JOIN (
    SELECT oc.user_id, MAX(o.score_global) AS best_score
    FROM ootd_competitions oc
    JOIN ootds o ON o.id = oc.ootd_id
    WHERE oc.competition_id = p_competition_id
      AND o.created_at >= v_since
    GROUP BY oc.user_id
  ) best ON best.user_id = cm.user_id
  WHERE cm.competition_id = p_competition_id;

  -- --- most_regular : streak_count le plus élevé, strictement positif.
  -- Reste NULL (donc jsonb null en sortie) si tout le monde est à 0.
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

  -- --- most_improved : plus grand delta (moyenne période courante - moyenne
  -- période précédente) parmi les membres ayant des données sur LES DEUX
  -- périodes (le JOIN cur/prev élimine automatiquement les autres -> NULL si
  -- personne ne qualifie).
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

  -- --- most_liked : tenue de la compétition créée sur la période avec le
  -- plus de likes. NULL si aucune tenue sur la période (pas de filtre sur le
  -- nombre de likes lui-même : une tenue à 0 like reste éligible si c'est la
  -- seule de la période).
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

REVOKE ALL ON FUNCTION public.get_competition_leaderboard(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_competition_leaderboard(uuid, text) TO authenticated;

-- ===========================================================================
-- 2. get_top3_app / get_top3_friends — période paramétrable (D5)
-- ===========================================================================
-- Postgres traite un changement de liste de paramètres comme une SURCHARGE
-- (nouvelle fonction en plus de l'existante) et non un remplacement : sans le
-- DROP explicite ci-dessous, get_top3_app() (0 argument, encore appelée par
-- RecapScreen tant qu'il n'est pas mis à jour) continuerait de coexister avec
-- get_top3_app(text), au lieu d'être remplacée par elle avec une valeur par
-- défaut.
DROP FUNCTION IF EXISTS public.get_top3_app();
DROP FUNCTION IF EXISTS public.get_top3_friends();

-- p_period='week' (valeur par défaut) reproduit EXACTEMENT le comportement
-- précédent : RecapScreen, qui appelle encore ces RPCs sans argument, continue
-- de recevoir le même classement hebdomadaire qu'avant.
CREATE OR REPLACE FUNCTION public.get_top3_app(p_period text DEFAULT 'week')
RETURNS TABLE(user_id uuid, username text, avatar_url text, best_score numeric)
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
  SELECT o.user_id, p.username, p.avatar_url, MAX(o.score_global) AS best_score
  FROM public.ootds o
  JOIN public.profiles p ON p.id = o.user_id
  CROSS JOIN bounds
  WHERE o.created_at >= bounds.start_at
    AND o.is_public = true
    AND p.is_private = false
  GROUP BY o.user_id, p.username, p.avatar_url
  ORDER BY best_score DESC
  LIMIT 3;
$$;
REVOKE ALL ON FUNCTION public.get_top3_app(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top3_app(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_top3_friends(p_period text DEFAULT 'week')
RETURNS TABLE(user_id uuid, username text, avatar_url text, best_score numeric)
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
  SELECT o.user_id, p.username, p.avatar_url, MAX(o.score_global) AS best_score
  FROM public.ootds o
  JOIN public.profiles p ON p.id = o.user_id
  CROSS JOIN bounds
  WHERE o.user_id IN (SELECT uid FROM my_friends)
    AND o.created_at >= bounds.start_at
    AND o.is_public = true
  GROUP BY o.user_id, p.username, p.avatar_url
  ORDER BY best_score DESC
  LIMIT 3;
$$;
REVOKE ALL ON FUNCTION public.get_top3_friends(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top3_friends(text) TO authenticated;

-- Les signatures RPC exposées par PostgREST changent (get_top3_app/friends
-- perdent leur variante 0-argument) : on force un reload du schema cache pour
-- que ça soit pris en compte immédiatement plutôt qu'au prochain déploiement.
NOTIFY pgrst, 'reload schema';
