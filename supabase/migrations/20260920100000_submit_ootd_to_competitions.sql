-- OOTD — Compétitions v2 : publication atomique (2026-09-20)
-- Remplace publishToFeed/saveForSelf/sendOutfitToSelectedFlammes côté client :
-- un seul appel qui insère la tenue, la relie à N compétitions, attribue les
-- points et met à jour les stats de style — tout ou rien, plutôt que
-- plusieurs inserts client enchaînés (fragile en cas d'échec partiel, comme
-- l'était l'ancienne boucle par ami dans sendOutfitToSelectedFlammes).

-- p_score_global est calculé côté client (pas recalculé ici en somme/moyenne) :
-- le passage moyenne(0-10) -> somme(0-100) est le périmètre de la Phase 4
-- (prompt IA v3), volontairement découplé de cette RPC de publication.
CREATE OR REPLACE FUNCTION public.submit_ootd_to_competitions(
  p_image_url          text,
  p_score_global       numeric,
  p_couleurs_note      numeric,
  p_coupe_note         numeric,
  p_style_note         numeric,
  p_conseil            text, -- JSON-stringifié côté client ({points_forts, axes_amelioration}) ou texte brut, comme ootds.conseil aujourd'hui
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
  v_uid       uuid := auth.uid();
  v_ootd_id   uuid;
  v_comp_id   uuid;
  v_award     jsonb;
  v_bad_comp  uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Non authentifié'); END IF;
  IF p_image_url IS NULL OR btrim(p_image_url) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Image manquante');
  END IF;

  -- Vérifie l'appartenance à TOUTES les compétitions ciblées avant d'insérer
  -- quoi que ce soit (évite un ootd orphelin si une seule est invalide).
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

  IF p_competition_ids IS NOT NULL THEN
    FOREACH v_comp_id IN ARRAY p_competition_ids LOOP
      INSERT INTO ootd_competitions (ootd_id, competition_id, user_id)
      VALUES (v_ootd_id, v_comp_id, v_uid)
      ON CONFLICT DO NOTHING;
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

REVOKE ALL ON FUNCTION public.submit_ootd_to_competitions(
  text, numeric, numeric, numeric, numeric, text, text, text[], boolean, text[],
  text, text, text, text, uuid[], boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_ootd_to_competitions(
  text, numeric, numeric, numeric, numeric, text, text, text[], boolean, text[],
  text, text, text, text, uuid[], boolean
) TO authenticated;
