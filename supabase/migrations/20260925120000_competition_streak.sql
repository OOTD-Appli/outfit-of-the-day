-- OOTD — Streak par compétition + restauration via Gel de Flamme (2026-09-25)
-- Décision produit D4 : le Gel de Flamme (item boutique existant, 0,99€) ne
-- protège plus un streak 1-à-1 entre deux personnes (ancien système
-- "flammes", table flammes conservée en base pour historique mais plus
-- alimentée depuis la bascule vers les Compétitions v2) — il protège
-- désormais une régularité de participation PAR COMPÉTITION : le nombre de
-- jours consécutifs où l'utilisateur a soumis au moins une tenue à CETTE
-- compétition précise.

-- ===========================================================================
-- 1. Colonnes de streak sur competition_members
-- ===========================================================================

ALTER TABLE public.competition_members
  ADD COLUMN IF NOT EXISTS streak_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_submission_date date;

-- ===========================================================================
-- 2. submit_ootd_to_competitions : ajoute la mise à jour du streak par
--    compétition ciblée, dans la même transaction que la publication (pas de
--    2e aller-retour client, pas de risque d'incohérence si le client crashe
--    entre les deux). Le reste de la fonction est repris à l'identique.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.submit_ootd_to_competitions(
  p_image_url          text,
  p_score_global       numeric,
  p_couleurs_note      numeric,
  p_coupe_note         numeric,
  p_style_note         numeric,
  p_conseil            text,
  p_caption            text,
  p_styles             text[],
  p_show_style_hashtag boolean,
  p_visible_scores     text[],
  p_audio_title        text,
  p_audio_artist       text,
  p_audio_preview_url  text,
  p_audio_cover_url    text,
  p_competition_ids    uuid[],
  p_make_public        boolean
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_ootd_id          uuid;
  v_comp_id          uuid;
  v_award            jsonb;
  v_bad_comp         uuid;
  v_today            date;
  v_streak_count     integer;
  v_last_submission  date;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Non authentifié'); END IF;
  IF p_image_url IS NULL OR btrim(p_image_url) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Image manquante');
  END IF;

  IF p_competition_ids IS NOT NULL AND array_length(p_competition_ids, 1) IS NOT NULL THEN
    SELECT cid INTO v_bad_comp
    FROM unnest(p_competition_ids) AS cid
    WHERE NOT EXISTS (
      SELECT 1 FROM competition_members cm WHERE cm.competition_id = cid AND cm.user_id = v_uid
    )
    LIMIT 1;
    IF v_bad_comp IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Compétition invalide ou tu n''en es plus membre');
    END IF;
  END IF;

  INSERT INTO ootds (
    user_id, image_url,
    score_global, score_couleurs, score_coupe, score_tendance,
    conseil, caption, is_public, styles, show_style_hashtag, visible_scores,
    audio_title, audio_artist, audio_preview_url, audio_cover_url
  ) VALUES (
    v_uid, p_image_url,
    p_score_global,
    p_couleurs_note, p_coupe_note, p_style_note,
    coalesce(p_conseil, ''), nullif(btrim(coalesce(p_caption, '')), ''), coalesce(p_make_public, false),
    coalesce(p_styles, '{}'), coalesce(p_show_style_hashtag, true), coalesce(p_visible_scores, '{}'),
    p_audio_title, p_audio_artist, p_audio_preview_url, p_audio_cover_url
  ) RETURNING id INTO v_ootd_id;

  -- Calculé une seule fois pour éviter que le streak change de "jour" en
  -- cours de boucle si p_competition_ids contient beaucoup d'entrées.
  v_today := (now() AT TIME ZONE 'Europe/Paris')::date;

  IF p_competition_ids IS NOT NULL THEN
    FOREACH v_comp_id IN ARRAY p_competition_ids LOOP
      INSERT INTO ootd_competitions (ootd_id, competition_id, user_id)
      VALUES (v_ootd_id, v_comp_id, v_uid)
      ON CONFLICT DO NOTHING;

      -- FOR UPDATE : verrouille la ligne membre le temps du calcul pour éviter
      -- une double incrémentation si deux soumissions arrivent en même temps
      -- pour la même compétition (rare mais possible avec upload concurrent).
      SELECT streak_count, last_submission_date
        INTO v_streak_count, v_last_submission
        FROM competition_members
       WHERE competition_id = v_comp_id AND user_id = v_uid
       FOR UPDATE;

      IF v_last_submission = v_today THEN
        -- Déjà soumis aujourd'hui pour cette compétition : idempotent, on ne
        -- touche à rien (évite qu'un 2e OOTD le même jour gonfle le streak).
        NULL;
      ELSIF v_last_submission = v_today - 1 THEN
        -- Jour consécutif : le streak continue.
        v_streak_count := v_streak_count + 1;
        v_last_submission := v_today;
      ELSE
        -- NULL (jamais soumis) ou trou de 2 jours ou plus : on repart de 1.
        v_streak_count := 1;
        v_last_submission := v_today;
      END IF;

      UPDATE competition_members
         SET streak_count = v_streak_count,
             last_submission_date = v_last_submission
       WHERE competition_id = v_comp_id AND user_id = v_uid;
    END LOOP;
  END IF;

  v_award := award_points_for_ootd(v_ootd_id);

  IF p_styles IS NOT NULL AND array_length(p_styles, 1) IS NOT NULL THEN
    PERFORM increment_style_stats(p_styles);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'ootd_id', v_ootd_id,
    'points_earned', coalesce((v_award ->> 'points_earned')::int, 0)
  );
END;
$$;

-- Pas de REVOKE/GRANT ici : la signature ne change pas par rapport à la
-- migration 20260920100000_submit_ootd_to_competitions.sql, CREATE OR REPLACE
-- conserve donc les privilèges déjà accordés (authenticated) sur cette fonction.

-- ===========================================================================
-- 3. restore_competition_streak : consomme 1 Gel de Flamme pour combler
--    EXACTEMENT un jour manqué hier sur une compétition donnée, en faisant
--    comme si la veille avait été couverte (la prochaine soumission du jour
--    incrémente alors le streak au lieu de le reset à 1). Même mécanique de
--    contournement de garde que restore_flamme / claim_monthly_freezes.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.restore_competition_streak(p_competition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_today   date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_last    date;
  v_freezes integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non authentifié');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM competition_members
    WHERE competition_id = p_competition_id AND user_id = v_uid
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non membre');
  END IF;

  -- FOR UPDATE : verrouille la ligne membre avant de décider si elle est
  -- restaurable, pour éviter un double clic qui consommerait 2 gels.
  SELECT last_submission_date INTO v_last
    FROM competition_members
   WHERE competition_id = p_competition_id AND user_id = v_uid
   FOR UPDATE;

  -- Restaurable uniquement si exactement 1 jour a été manqué hier. Si le trou
  -- est plus vieux, le streak est déjà retombé à 1 lors de la prochaine
  -- soumission (cf. submit_ootd_to_competitions) : un Gel ne rattrape qu'un
  -- oubli d'un jour, pas plusieurs.
  IF v_last IS DISTINCT FROM (v_today - 2) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Rien à restaurer');
  END IF;

  SELECT flame_freezes INTO v_freezes FROM profiles WHERE id = v_uid FOR UPDATE;
  IF coalesce(v_freezes, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Aucun gel de flamme disponible');
  END IF;

  -- profiles_guard_sensitive bloque l'écriture des colonnes sensibles
  -- (dont flame_freezes) hors trigger applicatif : on la contourne
  -- explicitement pour cette décrémentation légitime, comme partout ailleurs
  -- où le serveur consomme un gel (restore_flamme, claim_monthly_freezes).
  PERFORM set_config('app.bypass_profile_guard', 'on', true);
  UPDATE profiles SET flame_freezes = flame_freezes - 1 WHERE id = v_uid;

  -- On ne touche pas streak_count : seule la "couverture" de la veille est
  -- restaurée, le compteur reprendra sa progression à la prochaine soumission.
  UPDATE competition_members
     SET last_submission_date = v_today - 1
   WHERE competition_id = p_competition_id AND user_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'new_freezes', v_freezes - 1);
END;
$$;

REVOKE ALL ON FUNCTION public.restore_competition_streak(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_competition_streak(uuid) TO authenticated;
