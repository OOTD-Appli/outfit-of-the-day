-- OOTD — Compétitions v2 : création avec sélection d'amis (2026-09-23)
-- Remplace le flow "créer puis générer un lien d'invitation" comme étape
-- par défaut à la création : on choisit le nom ET les membres (parmi ses
-- amis acceptés) en une fois. Le lien d'invitation (create_competition_invite,
-- toujours en place) reste disponible pour ajouter des gens plus tard.

CREATE OR REPLACE FUNCTION public.create_competition_with_members(
  p_name       text,
  p_member_ids uuid[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_id        uuid;
  v_name      text := btrim(coalesce(p_name, ''));
  v_member_id uuid;
  v_bad_id    uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Non authentifié'); END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nom invalide (1 à 60 caractères)');
  END IF;

  -- Chaque membre proposé doit être un ami accepté (dans un sens ou l'autre) —
  -- empêche d'ajouter directement quelqu'un qui n'a jamais accepté de demande.
  IF p_member_ids IS NOT NULL AND array_length(p_member_ids, 1) IS NOT NULL THEN
    SELECT mid INTO v_bad_id
    FROM unnest(p_member_ids) AS mid
    WHERE mid <> v_uid
      AND NOT EXISTS (
        SELECT 1 FROM friendships f
        WHERE f.status = 'accepted'
          AND ((f.user_id = v_uid AND f.friend_id = mid) OR (f.user_id = mid AND f.friend_id = v_uid))
      )
    LIMIT 1;
    IF v_bad_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Un des membres sélectionnés n''est pas dans ta liste d''amis');
    END IF;
  END IF;

  INSERT INTO competitions (name, created_by) VALUES (v_name, v_uid) RETURNING id INTO v_id;
  INSERT INTO competition_members (competition_id, user_id) VALUES (v_id, v_uid);

  IF p_member_ids IS NOT NULL THEN
    FOREACH v_member_id IN ARRAY p_member_ids LOOP
      IF v_member_id <> v_uid THEN
        INSERT INTO competition_members (competition_id, user_id)
        VALUES (v_id, v_member_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'competition_id', v_id, 'name', v_name);
END;
$$;

REVOKE ALL ON FUNCTION public.create_competition_with_members(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_competition_with_members(text, uuid[]) TO authenticated;
