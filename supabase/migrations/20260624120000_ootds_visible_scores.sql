-- OOTD — Notes affichées sur la publication (2026-06-24)
-- L'auteur choisit, lors de la personnalisation, quelles notes afficher sur son
-- post dans le feed. Stocke les clés de colonnes scores sélectionnées
-- (ex : {'score_global','score_coupe'}). Vide = aucune note affichée par défaut.

ALTER TABLE public.ootds
  ADD COLUMN IF NOT EXISTS visible_scores text[] NOT NULL DEFAULT '{}';
