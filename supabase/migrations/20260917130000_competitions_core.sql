-- OOTD — Compétitions v2 : schéma de base (2026-09-17)
-- Remplace le mécanisme 1-à-1 (flammes) par des groupes nommés. Une tenue
-- (ootds, structure inchangée) peut être partagée à 0, 1 ou plusieurs
-- compétitions via ootd_competitions, indépendamment du flag ootds.is_public
-- qui continue de gérer le Feed public.

CREATE TABLE IF NOT EXISTS public.competitions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitions_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 60)
);

CREATE TABLE IF NOT EXISTS public.competition_members (
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at      timestamptz NOT NULL DEFAULT now(),
  last_read_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_competition_members_user ON public.competition_members(user_id);

-- user_id et created_at sont dénormalisés depuis ootds au moment de l'insert
-- pour permettre à hasSubmittedTodayForCompetition() de compter sans jointure.
CREATE TABLE IF NOT EXISTS public.ootd_competitions (
  ootd_id        uuid NOT NULL REFERENCES public.ootds(id) ON DELETE CASCADE,
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ootd_id, competition_id)
);
CREATE INDEX IF NOT EXISTS idx_ootd_competitions_comp_created ON public.ootd_competitions(competition_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ootd_competitions_comp_user_created ON public.ootd_competitions(competition_id, user_id, created_at DESC);

ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ootd_competitions ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- RLS — competitions : visible uniquement aux membres. Création/suppression
-- uniquement via create_competition() (pas de policy INSERT directe).
-- ===========================================================================

DROP POLICY IF EXISTS "competitions_select_member" ON public.competitions;
CREATE POLICY "competitions_select_member"
  ON public.competitions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.competition_members cm
    WHERE cm.competition_id = competitions.id AND cm.user_id = (SELECT auth.uid())
  ));

-- ===========================================================================
-- RLS — competition_members
-- Pas de policy INSERT directe : une policy WITH CHECK (user_id = auth.uid())
-- laisserait n'importe quel utilisateur s'auto-ajouter à n'importe quelle
-- compétition sans vérifier d'invitation. Rejoindre passe uniquement par
-- create_competition() ou redeem_competition_invite() (SECURITY DEFINER).
-- ===========================================================================

DROP POLICY IF EXISTS "competition_members_select_member" ON public.competition_members;
CREATE POLICY "competition_members_select_member"
  ON public.competition_members FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.competition_members cm2
    WHERE cm2.competition_id = competition_members.competition_id AND cm2.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "competition_members_delete_self" ON public.competition_members;
CREATE POLICY "competition_members_delete_self"
  ON public.competition_members FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ===========================================================================
-- RLS — ootd_competitions : table client-writable (le triple check ci-dessous
-- ferme le risque d'escalade sans passer par une RPC).
-- ===========================================================================

DROP POLICY IF EXISTS "ootd_competitions_select_member" ON public.ootd_competitions;
CREATE POLICY "ootd_competitions_select_member"
  ON public.ootd_competitions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.competition_members cm
    WHERE cm.competition_id = ootd_competitions.competition_id AND cm.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "ootd_competitions_insert_own" ON public.ootd_competitions;
CREATE POLICY "ootd_competitions_insert_own"
  ON public.ootd_competitions FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.ootds o WHERE o.id = ootd_id AND o.user_id = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.competition_members cm WHERE cm.competition_id = ootd_competitions.competition_id AND cm.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS "ootd_competitions_delete_own" ON public.ootd_competitions;
CREATE POLICY "ootd_competitions_delete_own"
  ON public.ootd_competitions FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ===========================================================================
-- RPC — create_competition : crée le groupe + y ajoute son créateur.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.create_competition(p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_name text := btrim(coalesce(p_name, ''));
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'Non authentifié'); END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Nom invalide (1 à 60 caractères)');
  END IF;

  INSERT INTO competitions (name, created_by) VALUES (v_name, v_uid) RETURNING id INTO v_id;
  INSERT INTO competition_members (competition_id, user_id) VALUES (v_id, v_uid);

  RETURN jsonb_build_object('ok', true, 'competition_id', v_id, 'name', v_name);
END;
$$;

REVOKE ALL ON FUNCTION public.create_competition(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_competition(text) TO authenticated;
