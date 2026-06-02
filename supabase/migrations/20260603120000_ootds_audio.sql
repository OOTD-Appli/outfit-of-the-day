-- OOTD — Métadonnées audio sur les posts (2026-06-03)
-- Stocke uniquement des métadonnées texte : aucun fichier audio n'est hébergé.
-- La preview 30s est streamée depuis l'URL iTunes/Deezer au moment du play.

ALTER TABLE public.ootds
  ADD COLUMN IF NOT EXISTS audio_title        text,
  ADD COLUMN IF NOT EXISTS audio_artist       text,
  ADD COLUMN IF NOT EXISTS audio_preview_url  text,
  ADD COLUMN IF NOT EXISTS audio_cover_url    text;
