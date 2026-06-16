-- Autorise les fichiers audio dans le bucket ootds.
-- On n'ajoute les types audio QUE si allowed_mime_types est déjà restreint
-- (IS NOT NULL) pour ne pas transformer un bucket permissif en bucket restreint.
UPDATE storage.buckets
SET allowed_mime_types = array_cat(
  allowed_mime_types,
  ARRAY['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/x-m4a']::text[]
)
WHERE id = 'ootds'
  AND allowed_mime_types IS NOT NULL;
