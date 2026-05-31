-- OOTD — Boutique : grille finale + achats express en euros (2026-05-31)
-- 1. Nouveaux prix points cosmétiques (thèmes 1000/1500, logos 150/200).
-- 2. Achats express Stripe one-time (0,99€) : Gel de Flamme & Pack 2 000 points.
--    Le crédit (points / gel) est posé UNIQUEMENT par le webhook Stripe
--    (service_role) via apply_one_time_purchase, idempotent par session.

-- ===========================================================================
-- 1. buy_cosmetic v3 : nouvelle grille par rareté
--    Thèmes : default/midnight/emerald = 1000 · gold/sakura = 1500
--    Logos  : default/fire = 150 · diamond/star/crown = 200
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
  v_valid_logos  text[] := ARRAY['default','diamond','crown','fire','star'];
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

  -- Prix par rareté, autorité unique côté serveur
  v_price := CASE
    WHEN item_type = 'theme' THEN
      CASE WHEN item_id IN ('gold', 'sakura') THEN 1500 ELSE 1000 END
    ELSE
      CASE WHEN item_id = 'fire' THEN 150 ELSE 200 END
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
-- 2. processed_payments : journal d'idempotence des achats one-time
--    (RLS activé, aucune policy => seul service_role y accède)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.processed_payments (
  session_id text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.processed_payments ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- 3. apply_one_time_purchase : fulfillment d'un achat express (webhook only)
--    Idempotent : une session Stripe n'est créditée qu'une fois.
--    Produits : 'points_2000' (+2000 pts) · 'flame_freeze' (+1 gel)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.apply_one_time_purchase(
  p_session_id text,
  p_user_id    uuid,
  p_product    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_product NOT IN ('points_2000', 'flame_freeze') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Produit inconnu');
  END IF;

  -- Garde d'idempotence : si la session est déjà traitée, on ne recrédite pas
  INSERT INTO processed_payments (session_id, user_id, product)
  VALUES (p_session_id, p_user_id, p_product)
  ON CONFLICT (session_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true);
  END IF;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  IF p_product = 'points_2000' THEN
    UPDATE profiles SET points = points + 2000 WHERE id = p_user_id;
  ELSE
    UPDATE profiles SET flame_freezes = flame_freezes + 1 WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_one_time_purchase(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_one_time_purchase(text, uuid, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_one_time_purchase(text, uuid, text) TO service_role;
