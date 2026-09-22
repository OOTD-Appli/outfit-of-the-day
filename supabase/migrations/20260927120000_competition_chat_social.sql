-- OOTD — Chat de compétition v2 : réponses, likes, réactions emoji (2026-09-27)
-- Le mockup HTML (maquette validée, l'écran React Native est réécrit en
-- parallèle par quelqu'un d'autre) ajoute 3 comportements au chat de groupe
-- existant (competition_messages, déjà en prod) :
--   1. Répondre à un message (swipe-to-reply avec citation) — juste une FK
--      auto-référente, pas de RPC : le frontend insère reply_to_id dans son
--      INSERT existant sur competition_messages, déjà couvert par la policy
--      competition_messages_insert_member (20260918120000_competition_messages.sql).
--   2. Liker un message (plusieurs personnes, compteur agrégé).
--   3. Réagir avec un emoji parmi une whitelist fermée (chips agrégées).
-- Comme pour les autres tables sociales de l'app, les écritures sur les
-- tables like/reaction passent PAR une RPC SECURITY DEFINER plutôt que par
-- des policies INSERT/DELETE directes : un WITH CHECK ne protégerait pas
-- contre un client qui mentirait sur le user_id envoyé dans l'INSERT, alors
-- que la RPC force toujours auth.uid() côté serveur. Ça permet aussi un
-- toggle like/unlike atomique en un seul aller-retour réseau.

-- ===========================================================================
-- 1. Réponse à un message (swipe-to-reply)
-- ===========================================================================

ALTER TABLE public.competition_messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.competition_messages(id) ON DELETE SET NULL;

-- Index partiel : la grande majorité des messages ne sont pas des réponses,
-- inutile d'indexer les lignes reply_to_id IS NULL.
CREATE INDEX IF NOT EXISTS idx_competition_messages_reply_to
  ON public.competition_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

-- "Répondre" depuis la vue plein écran d'une tenue (swipe vers le haut sur
-- une photo) n'a pas de message existant à cibler via reply_to_id — ce n'est
-- pas une réponse à un AUTRE message, mais à une tenue du jour. On stocke
-- alors juste un libellé plat ("Réponse à la tenue de Lucas"), affiché comme
-- citation au-dessus du texte, sans lien FK. Mutuellement exclusif avec
-- reply_to_id : une réponse-à-message n'utilise jamais cette colonne (le
-- client relit le message cité dynamiquement via reply_to_id à la place, pour
-- ne jamais désynchroniser un texte dupliqué).
ALTER TABLE public.competition_messages
  ADD COLUMN IF NOT EXISTS quoted_label text;

-- ===========================================================================
-- 2. Likes (plusieurs personnes par message, avec compteur agrégé)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.competition_message_likes (
  message_id uuid NOT NULL REFERENCES public.competition_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE public.competition_message_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competition_message_likes_select_member" ON public.competition_message_likes;
CREATE POLICY "competition_message_likes_select_member"
  ON public.competition_message_likes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.competition_messages cm
    WHERE cm.id = message_id AND public.is_competition_member(cm.competition_id)
  ));
-- Pas de policy INSERT/UPDATE/DELETE : uniquement via
-- toggle_competition_message_like() ci-dessous, sinon n'importe quel membre
-- pourrait insérer un like au nom d'un autre user_id.

-- ===========================================================================
-- 3. Réactions emoji (whitelist fermée, chips agrégées)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.competition_message_reactions (
  message_id uuid NOT NULL REFERENCES public.competition_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji),
  -- Whitelist reprise du mockup : verrouillée côté serveur (pas seulement
  -- côté UI, qui pourrait être contournée) pour éviter de stocker n'importe
  -- quelle chaîne comme "emoji".
  CONSTRAINT competition_message_reactions_emoji_valid
    CHECK (emoji IN ('😂', '🔥', '❤️', '😮', '👍'))
);

ALTER TABLE public.competition_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "competition_message_reactions_select_member" ON public.competition_message_reactions;
CREATE POLICY "competition_message_reactions_select_member"
  ON public.competition_message_reactions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.competition_messages cm
    WHERE cm.id = message_id AND public.is_competition_member(cm.competition_id)
  ));
-- Pas de policy INSERT/DELETE directe non plus : uniquement via
-- add_competition_message_reaction() ci-dessous (même raison que les likes).

-- ===========================================================================
-- 4. toggle_competition_message_like — like / unlike atomique
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.toggle_competition_message_like(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid            uuid := auth.uid();
  v_competition_id uuid;
  v_liked          boolean;
  v_like_count     integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non authentifié');
  END IF;

  SELECT competition_id INTO v_competition_id
    FROM competition_messages
   WHERE id = p_message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Message introuvable');
  END IF;

  IF NOT is_competition_member(v_competition_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non membre');
  END IF;

  IF EXISTS (
    SELECT 1 FROM competition_message_likes
    WHERE message_id = p_message_id AND user_id = v_uid
  ) THEN
    DELETE FROM competition_message_likes WHERE message_id = p_message_id AND user_id = v_uid;
    v_liked := false;
  ELSE
    INSERT INTO competition_message_likes (message_id, user_id) VALUES (p_message_id, v_uid);
    v_liked := true;
  END IF;

  SELECT count(*) INTO v_like_count FROM competition_message_likes WHERE message_id = p_message_id;

  RETURN jsonb_build_object('ok', true, 'liked', v_liked, 'like_count', v_like_count);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_competition_message_like(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.toggle_competition_message_like(uuid) TO authenticated;

-- ===========================================================================
-- 5. add_competition_message_reaction — ajoute une réaction
--    V1 : ajout uniquement, pas de retrait (un "unlike" de réaction pourra
--    être ajouté plus tard si le besoin se confirme côté produit).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.add_competition_message_reaction(p_message_id uuid, p_emoji text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid            uuid := auth.uid();
  v_competition_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non authentifié');
  END IF;

  SELECT competition_id INTO v_competition_id
    FROM competition_messages
   WHERE id = p_message_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Message introuvable');
  END IF;

  IF NOT is_competition_member(v_competition_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Non membre');
  END IF;

  -- Revérifiée ici en plus de la CHECK constraint : renvoie une erreur
  -- métier propre ('Emoji invalide') plutôt qu'une exception Postgres brute
  -- que le client devrait parser.
  IF p_emoji NOT IN ('😂', '🔥', '❤️', '😮', '👍') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Emoji invalide');
  END IF;

  INSERT INTO competition_message_reactions (message_id, user_id, emoji)
  VALUES (p_message_id, v_uid, p_emoji)
  ON CONFLICT (message_id, user_id, emoji) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.add_competition_message_reaction(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_competition_message_reaction(uuid, text) TO authenticated;

-- Les 2 nouvelles RPCs doivent apparaître immédiatement côté PostgREST plutôt
-- qu'au prochain déploiement.
NOTIFY pgrst, 'reload schema';
