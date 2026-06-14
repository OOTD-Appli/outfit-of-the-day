-- OOTD — Nouveaux logos visuels (2026-06-14)
-- Ajoute 5 variantes de logos avec images : bleu_neon, sunset, vert_neon,
-- rose_flashy, rose_pastel. Prix entre 500 et 750 pts.
-- Met à jour buy_cosmetic et equip_cosmetic (whitelist côté serveur).

-- ===========================================================================
-- 1. buy_cosmetic v3 : ajoute les nouveaux ids logos
-- ===========================================================================

CREATE OR REPLACE FUNCTION buy_cosmetic(item_type text, item_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid   := auth.uid();
  v_prof         profiles%ROWTYPE;
  v_price        integer;
  v_current      text[];
  v_valid_themes text[] := ARRAY['default','midnight','emerald','gold','sakura'];
  v_valid_logos  text[] := ARRAY[
    'default','diamond','crown','fire','star',
    'bleu_neon','sunset','vert_neon','rose_flashy','rose_pastel'
  ];
BEGIN
  IF item_type NOT IN ('theme', 'logo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Type invalide');
  END IF;
  IF item_type = 'theme' AND NOT (item_id = ANY(v_valid_themes)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Thème invalide');
  END IF;
  IF item_type = 'logo' AND NOT (item_id = ANY(v_valid_logos)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Logo invalide');
  END IF;

  v_price := CASE
    WHEN item_type = 'theme' THEN
      CASE WHEN item_id IN ('gold', 'sakura') THEN 400 ELSE 250 END
    ELSE
      CASE item_id
        WHEN 'crown'       THEN 500
        WHEN 'diamond'     THEN 200
        WHEN 'star'        THEN 200
        WHEN 'bleu_neon'   THEN 500
        WHEN 'sunset'      THEN 600
        WHEN 'vert_neon'   THEN 500
        WHEN 'rose_flashy' THEN 650
        WHEN 'rose_pastel' THEN 750
        ELSE 100
      END
  END;

  SELECT * INTO v_prof FROM profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
  END IF;

  v_current := CASE item_type WHEN 'theme' THEN v_prof.unlocked_themes ELSE v_prof.unlocked_logos END;

  IF item_id = ANY(v_current) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Déjà dans ta collection');
  END IF;
  IF v_prof.points < v_price THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Points insuffisants',
      'points', v_prof.points,
      'required', v_price
    );
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  IF item_type = 'theme' THEN
    UPDATE profiles SET
      points          = points - v_price,
      unlocked_themes = array_append(unlocked_themes, item_id)
    WHERE id = v_uid;
  ELSE
    UPDATE profiles SET
      points         = points - v_price,
      unlocked_logos = array_append(unlocked_logos, item_id)
    WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true, 'new_points', v_prof.points - v_price);
END;
$$;

-- ===========================================================================
-- 2. equip_cosmetic v3 : même whitelist étendue
-- ===========================================================================

CREATE OR REPLACE FUNCTION equip_cosmetic(item_type text, item_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_owned        boolean;
  v_valid_themes text[] := ARRAY['default','midnight','emerald','gold','sakura'];
  v_valid_logos  text[] := ARRAY[
    'default','diamond','crown','fire','star',
    'bleu_neon','sunset','vert_neon','rose_flashy','rose_pastel'
  ];
BEGIN
  IF item_type NOT IN ('theme', 'logo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Type invalide');
  END IF;
  IF item_type = 'theme' AND NOT (item_id = ANY(v_valid_themes)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Thème invalide');
  END IF;
  IF item_type = 'logo' AND NOT (item_id = ANY(v_valid_logos)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Logo invalide');
  END IF;

  IF item_id = 'default' OR public.is_elite(v_uid) THEN
    v_owned := true;
  ELSE
    SELECT CASE item_type
      WHEN 'theme' THEN (item_id = ANY(unlocked_themes) OR has_ootd_plus_pass)
      ELSE               (item_id = ANY(unlocked_logos)  OR has_ootd_plus_pass)
    END INTO v_owned
    FROM profiles WHERE id = v_uid;
  END IF;

  IF NOT coalesce(v_owned, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Article non possédé');
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  IF item_type = 'theme' THEN
    UPDATE profiles SET active_theme = item_id WHERE id = v_uid;
  ELSE
    UPDATE profiles SET active_logo  = item_id WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;
