-- Scores sur les outfits envoyés en Flammes (snaps + messages).
-- Permet d'afficher les 4 notes (fit/harmonie/détails/global) + le conseil IA
-- dans le chat lorsqu'un ami reçoit une tenue analysée.
-- Colonnes nullables : un message texte/photo classique n'a pas de scores.

ALTER TABLE public.snaps
  ADD COLUMN IF NOT EXISTS score_global   numeric,
  ADD COLUMN IF NOT EXISTS score_couleurs numeric,
  ADD COLUMN IF NOT EXISTS score_coupe    numeric,
  ADD COLUMN IF NOT EXISTS score_tendance numeric,
  ADD COLUMN IF NOT EXISTS conseil        text;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS score_global   numeric,
  ADD COLUMN IF NOT EXISTS score_couleurs numeric,
  ADD COLUMN IF NOT EXISTS score_coupe    numeric,
  ADD COLUMN IF NOT EXISTS score_tendance numeric,
  ADD COLUMN IF NOT EXISTS conseil        text;
