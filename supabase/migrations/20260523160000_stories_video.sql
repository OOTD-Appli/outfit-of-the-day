-- Ajout du support vidéo et métadonnées pour les stories (tâche 11)
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS video_url text,
  ADD COLUMN IF NOT EXISTS overlay_text text,
  ADD COLUMN IF NOT EXISTS caption text;

-- image_url peut maintenant être NULL (story vidéo sans image)
ALTER TABLE stories ALTER COLUMN image_url DROP NOT NULL;

-- Contrainte : au moins image_url ou video_url doit être renseigné
ALTER TABLE stories
  ADD CONSTRAINT stories_has_media CHECK (image_url IS NOT NULL OR video_url IS NOT NULL);
