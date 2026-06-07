-- OOTD — Visibilité par post (2026-06-07)
-- is_public = true  : publié dans le feed (audience selon la confidentialité du compte)
-- is_public = false : enregistré uniquement dans la galerie perso (pas dans le feed)
-- Les posts existants restent visibles (défaut true).

ALTER TABLE public.ootds
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_ootds_public_created
  ON public.ootds(is_public, created_at DESC);
