-- OOTD — Abonnements Premium Stripe (2026-05-31)
-- Sépare l'économie : points (cosmétiques, inchangé) vs abonnement Stripe (Premium).
--
-- À exécuter dans le SQL Editor Supabase (ou `supabase db push`).
--
-- IMPORTANT (sécurité) :
--   * La table `subscriptions` est en lecture seule pour l'utilisateur (RLS).
--   * Aucune écriture client : seul le webhook Stripe (service_role) met à jour
--     l'abonnement via la RPC `apply_subscription_change` (SECURITY DEFINER,
--     EXECUTE révoqué pour anon/authenticated).
--   * Le statut Premium (Elite/Plus) n'est JAMAIS stocké en clair côté client :
--     il est dérivé de la table `subscriptions` à chaque vérification serveur.

-- ===========================================================================
-- 1. Table subscriptions
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text UNIQUE,
  status                 text NOT NULL DEFAULT 'inactive',  -- active | trialing | canceled | past_due | incomplete | inactive
  plan_type              text,                              -- 'plus' | 'elite'
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS subscriptions_user_idx     ON public.subscriptions (user_id);
CREATE INDEX IF NOT EXISTS subscriptions_customer_idx ON public.subscriptions (stripe_customer_id);

-- ===========================================================================
-- 2. RLS : l'utilisateur peut LIRE son abonnement, jamais l'écrire
-- ===========================================================================

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Pas de policy INSERT/UPDATE/DELETE pour authenticated => écriture impossible
-- depuis le client. Seul service_role (webhook) ou les RPC SECURITY DEFINER écrivent.

-- ===========================================================================
-- 3. Helper : is_elite(uid) — accès cosmétiques Elite, dérivé de l'abonnement
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.is_elite(p_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM subscriptions
     WHERE user_id = p_uid
       AND status IN ('active', 'trialing')
       AND plan_type = 'elite'
  );
$$;

-- ===========================================================================
-- 4. RPC webhook-only : apply_subscription_change
--    Upsert de l'abonnement. Appelée UNIQUEMENT par le webhook Stripe
--    (service_role). EXECUTE révoqué pour anon/authenticated => un client
--    ne peut pas s'auto-attribuer un abonnement.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.apply_subscription_change(
  p_user_id         uuid,
  p_customer_id     text,
  p_subscription_id text,
  p_status          text,
  p_plan_type       text,
  p_period_end      timestamptz,
  p_cancel_at_end   boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO subscriptions AS sub (
    user_id, stripe_customer_id, stripe_subscription_id,
    status, plan_type, current_period_end, cancel_at_period_end, updated_at
  )
  VALUES (
    p_user_id, p_customer_id, p_subscription_id,
    p_status, p_plan_type, p_period_end, coalesce(p_cancel_at_end, false), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    stripe_customer_id     = coalesce(excluded.stripe_customer_id, sub.stripe_customer_id),
    stripe_subscription_id = excluded.stripe_subscription_id,
    status                 = excluded.status,
    plan_type              = excluded.plan_type,
    current_period_end     = excluded.current_period_end,
    cancel_at_period_end   = excluded.cancel_at_period_end,
    updated_at             = now();
  -- NB : l'accès Elite aux cosmétiques est dérivé dynamiquement (is_elite),
  --      donc rien à modifier dans profiles ici (révocable proprement à la résiliation).
END;
$$;

REVOKE ALL ON FUNCTION public.apply_subscription_change(uuid, text, text, text, text, timestamptz, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_subscription_change(uuid, text, text, text, text, timestamptz, boolean) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.apply_subscription_change(uuid, text, text, text, text, timestamptz, boolean) TO service_role;

-- ===========================================================================
-- 5. consume_daily_credit v2 : tiers abonnement
--    Elite = illimité (pas de décrément) · Plus / pass legacy = 20 · Free = 2
-- ===========================================================================

CREATE OR REPLACE FUNCTION consume_daily_credit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits    integer;
  v_reset_date date;
  v_has_legacy boolean;
  v_plan       text;
  v_tier       text;
  v_max        integer;
  v_today      date := CURRENT_DATE;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Accès refusé');
  END IF;

  SELECT daily_credits,
         credits_reset_date,
         (has_analysis_pass OR has_ootd_plus_pass)
    INTO v_credits, v_reset_date, v_has_legacy
    FROM profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Profil introuvable');
  END IF;

  -- Abonnement Stripe actif le plus avantageux
  SELECT plan_type INTO v_plan
    FROM subscriptions
   WHERE user_id = p_user_id
     AND status IN ('active', 'trialing')
   ORDER BY (plan_type = 'elite') DESC, current_period_end DESC NULLS LAST
   LIMIT 1;

  v_tier := CASE
    WHEN v_plan = 'elite' THEN 'elite'
    WHEN v_plan = 'plus' OR v_has_legacy THEN 'plus'
    ELSE 'free'
  END;

  -- Elite : analyses illimitées (aucun décrément). credits/max = -1 (sentinelle).
  IF v_tier = 'elite' THEN
    RETURN jsonb_build_object('ok', true, 'credits', -1, 'max_credits', -1, 'unlimited', true);
  END IF;

  v_max := CASE v_tier WHEN 'plus' THEN 20 ELSE 2 END;

  PERFORM set_config('app.bypass_profile_guard', 'on', true);

  IF v_reset_date < v_today THEN
    v_credits := v_max;
    UPDATE profiles
       SET daily_credits = v_max, credits_reset_date = v_today
     WHERE id = p_user_id;
  END IF;

  IF v_credits <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Plus d''analyses disponibles aujourd''hui',
      'credits', 0,
      'max_credits', v_max
    );
  END IF;

  UPDATE profiles SET daily_credits = daily_credits - 1 WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'credits', v_credits - 1,
    'max_credits', v_max
  );
END;
$$;

-- ===========================================================================
-- 6. equip_cosmetic v2 : un abonné Elite possède d'office tous les cosmétiques
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
