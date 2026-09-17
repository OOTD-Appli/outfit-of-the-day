-- OOTD — Correction de prix : buy_cosmetic (2026-09-17)
-- 20260614120000_new_logo_variants.sql avait involontairement écrasé la grille
-- de prix de 20260531140000_shop_express.sql en repartant de la version
-- précédente. Corrige les prix (thèmes 1000/1500, logos 150/200, crown à 200
-- comme diamond/star) sans toucher au catalogue de logos ni au bypass Elite
-- (géré par equip_cosmetic, non touché ici).

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
  v_valid_logos  text[] := ARRAY['default','diamond','crown','fire','star','bleu_neon','sunset','vert_neon','rose_flashy','rose_pastel'];
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
      CASE WHEN item_id IN ('gold', 'sakura') THEN 1500 ELSE 1000 END
    ELSE
      CASE item_id
        WHEN 'fire'        THEN 150
        WHEN 'default'     THEN 150
        WHEN 'diamond'     THEN 200
        WHEN 'star'        THEN 200
        WHEN 'crown'       THEN 200
        WHEN 'bleu_neon'   THEN 500
        WHEN 'sunset'      THEN 600
        WHEN 'vert_neon'   THEN 500
        WHEN 'rose_flashy' THEN 650
        WHEN 'rose_pastel' THEN 750
        ELSE 200
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
