-- Table commentaires sous chaque OOTD — à exécuter dans SQL Editor Supabase après les autres migrations.
-- Liaison utilisateur vers public.profiles (même identifiant que auth.users), pour permettre embed profiles().

CREATE TABLE IF NOT EXISTS public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  ootd_id uuid NOT NULL REFERENCES public.ootds (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now (),
  CONSTRAINT comments_body_len CHECK (
    char_length(trim(body)) > 0
    AND char_length(body) <= 1000
  )
);

CREATE INDEX IF NOT EXISTS idx_comments_ootd_created
  ON public.comments (ootd_id, created_at DESC);

ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_select_authenticated" ON public.comments;
DROP POLICY IF EXISTS "comments_insert_own" ON public.comments;
DROP POLICY IF EXISTS "comments_delete_own" ON public.comments;

CREATE POLICY "comments_select_authenticated"
  ON public.comments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "comments_insert_own"
  ON public.comments FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid ()));

CREATE POLICY "comments_delete_own"
  ON public.comments FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid ()));
