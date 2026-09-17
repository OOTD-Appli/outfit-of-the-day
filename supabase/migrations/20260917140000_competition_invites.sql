-- OOTD — Compétitions v2 : liens d'invitation (2026-09-17)
-- Aucun mécanisme d'invitation n'existait dans le code (vérifié). Conçu ici
-- de zéro : token aléatoire, aperçu accessible sans compte (anon), adhésion
-- explicite via redeem_competition_invite (jamais automatique — l'écran
-- client affiche toujours un aperçu + bouton "Rejoindre" avant d'appeler
-- redeem). N'importe quel membre peut créer/révoquer un lien.

CREATE TABLE IF NOT EXISTS public.competition_invites (
  token          text PRIMARY KEY DEFAULT encode(gen_random_bytes(16), 'hex'),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  created_by     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  max_uses       integer,
  use_count      integer NOT NULL DEFAULT 0,
  revoked_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_competition_invites_comp ON public.competition_invites(competition_id);

ALTER TABLE public.competition_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competition_invites_select_member" ON public.competition_invites;
CREATE POLICY "competition_invites_select_member"
  ON public.competition_invites FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.competition_members cm
    WHERE cm.competition_id = competition_invites.competition_id AND cm.user_id = (SELECT auth.uid())
  ));
-- Pas de policy INSERT/UPDATE/DELETE : uniquement via les RPC ci-dessous.

-- ===========================================================================
-- create_competition_invite : n'importe quel membre actuel peut générer un lien.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.create_competition_invite(
  p_competition_id  uuid,
  p_max_uses        integer DEFAULT NULL,
  p_expires_in_days integer DEFAULT 7
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM competition_members WHERE competition_id = p_competition_id AND user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non membre de cette compétition');
  END IF;

  INSERT INTO competition_invites (competition_id, created_by, max_uses, expires_at)
  VALUES (p_competition_id, v_uid, p_max_uses, now() + make_interval(days => greatest(coalesce(p_expires_in_days, 7), 1)))
  RETURNING token INTO v_token;

  RETURN jsonb_build_object('ok', true, 'token', v_token);
END;
$$;
REVOKE ALL ON FUNCTION public.create_competition_invite(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_competition_invite(uuid, integer, integer) TO authenticated;

-- ===========================================================================
-- get_competition_invite_preview : lecture seule, accessible sans compte
-- (anon) pour afficher "Rejoins <nom> (N membres)" avant même l'inscription.
-- N'expose rien au-delà du nom et du nombre de membres.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_competition_invite_preview(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inv record;
  v_name text;
  v_count integer;
BEGIN
  SELECT * INTO v_inv FROM competition_invites WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Lien invalide'); END IF;
  IF v_inv.revoked_at IS NOT NULL OR v_inv.expires_at < now()
     OR (v_inv.max_uses IS NOT NULL AND v_inv.use_count >= v_inv.max_uses) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lien expiré ou épuisé');
  END IF;
  SELECT name INTO v_name FROM competitions WHERE id = v_inv.competition_id;
  SELECT count(*) INTO v_count FROM competition_members WHERE competition_id = v_inv.competition_id;
  RETURN jsonb_build_object('ok', true, 'competition_id', v_inv.competition_id, 'competition_name', v_name, 'member_count', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.get_competition_invite_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_competition_invite_preview(text) TO anon, authenticated;

-- ===========================================================================
-- redeem_competition_invite : adhésion explicite (appelée seulement après que
-- l'utilisateur a confirmé sur l'écran d'aperçu). Idempotent.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.redeem_competition_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv record;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'auth_required'); END IF;

  SELECT * INTO v_inv FROM competition_invites WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Lien invalide'); END IF;
  IF v_inv.revoked_at IS NOT NULL OR v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lien expiré');
  END IF;

  IF EXISTS (SELECT 1 FROM competition_members WHERE competition_id = v_inv.competition_id AND user_id = v_uid) THEN
    SELECT name INTO v_name FROM competitions WHERE id = v_inv.competition_id;
    RETURN jsonb_build_object('ok', true, 'already_member', true, 'competition_id', v_inv.competition_id, 'competition_name', v_name);
  END IF;

  IF v_inv.max_uses IS NOT NULL AND v_inv.use_count >= v_inv.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Lien épuisé');
  END IF;

  INSERT INTO competition_members (competition_id, user_id) VALUES (v_inv.competition_id, v_uid);
  UPDATE competition_invites SET use_count = use_count + 1 WHERE token = p_token;

  SELECT name INTO v_name FROM competitions WHERE id = v_inv.competition_id;
  RETURN jsonb_build_object('ok', true, 'competition_id', v_inv.competition_id, 'competition_name', v_name);
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_competition_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_competition_invite(text) TO authenticated;

-- ===========================================================================
-- revoke_competition_invite : n'importe quel membre peut révoquer un lien.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.revoke_competition_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_comp uuid;
BEGIN
  SELECT competition_id INTO v_comp FROM competition_invites WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Introuvable'); END IF;
  IF NOT EXISTS (SELECT 1 FROM competition_members WHERE competition_id = v_comp AND user_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non autorisé');
  END IF;
  UPDATE competition_invites SET revoked_at = now() WHERE token = p_token;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_competition_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_competition_invite(text) TO authenticated;
