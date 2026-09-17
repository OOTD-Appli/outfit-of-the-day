-- OOTD — Compétitions v2 : classements Top 3 (2026-09-19)
-- Reset hebdomadaire (rituel vivant plutôt que classement figé à vie).
-- Groupé par utilisateur (MAX du score) plutôt qu'un pur "top 3 tenues", pour
-- éviter qu'un même utilisateur apparaisse deux fois dans un classement de
-- personnes. "Top 3 amis" utilise friendships (concept indépendant des
-- compétitions, conservé tel quel), pas l'appartenance à une compétition
-- commune.
--
-- Filtrage : les deux classements excluent is_public=false (une sauvegarde
-- privée ne doit pas fuiter dans un classement) ; le classement app-wide
-- exclut aussi les profils is_private=true (cohérent avec le Feed public).

CREATE OR REPLACE FUNCTION public.get_top3_app()
RETURNS TABLE(user_id uuid, username text, avatar_url text, best_score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH week AS (
    SELECT (date_trunc('week', (now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris') AS start_at
  )
  SELECT o.user_id, p.username, p.avatar_url, MAX(o.score_global) AS best_score
  FROM public.ootds o
  JOIN public.profiles p ON p.id = o.user_id
  CROSS JOIN week
  WHERE o.created_at >= week.start_at
    AND o.is_public = true
    AND p.is_private = false
  GROUP BY o.user_id, p.username, p.avatar_url
  ORDER BY best_score DESC
  LIMIT 3;
$$;
REVOKE ALL ON FUNCTION public.get_top3_app() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top3_app() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_top3_friends()
RETURNS TABLE(user_id uuid, username text, avatar_url text, best_score numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH my_friends AS (
    SELECT friend_id AS uid FROM public.friendships WHERE user_id = auth.uid() AND status = 'accepted'
    UNION
    SELECT user_id AS uid FROM public.friendships WHERE friend_id = auth.uid() AND status = 'accepted'
  ),
  week AS (
    SELECT (date_trunc('week', (now() AT TIME ZONE 'Europe/Paris')) AT TIME ZONE 'Europe/Paris') AS start_at
  )
  SELECT o.user_id, p.username, p.avatar_url, MAX(o.score_global) AS best_score
  FROM public.ootds o
  JOIN public.profiles p ON p.id = o.user_id
  CROSS JOIN week
  WHERE o.user_id IN (SELECT uid FROM my_friends)
    AND o.created_at >= week.start_at
    AND o.is_public = true
  GROUP BY o.user_id, p.username, p.avatar_url
  ORDER BY best_score DESC
  LIMIT 3;
$$;
REVOKE ALL ON FUNCTION public.get_top3_friends() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_top3_friends() TO authenticated;
