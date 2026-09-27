-- Recadrage/zoom des stories vidéo (pas de ré-encodage côté client, irréaliste avec
-- Expo) : on stocke le cadrage choisi (échelle + décalage normalisés 0-1 par rapport
-- au cadre d'affichage) et on le réapplique à l'affichage (viewer + aperçu) via un
-- transform CSS/Animated, comme le font Instagram/Snapchat en interne.
-- Défauts neutres (échelle 1, décalage 0) : les stories déjà publiées s'affichent
-- sans aucun changement.
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS media_scale numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS media_offset_x numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_offset_y numeric NOT NULL DEFAULT 0;
