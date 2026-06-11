-- OOTD — Contraintes image_url (SEC-09)
-- Empêche les clients de stocker des URLs arbitraires dans image_url.
-- Utilise NOT VALID pour ne pas valider les lignes existantes (risque de casser des données).
-- Pour valider les données existantes après nettoyage éventuel :
--   VALIDATE CONSTRAINT ootds_image_url_valid;
--   VALIDATE CONSTRAINT messages_image_url_valid;

ALTER TABLE public.ootds
  ADD CONSTRAINT ootds_image_url_valid
  CHECK (image_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/')
  NOT VALID;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_image_url_valid
  CHECK (image_url IS NULL OR image_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/')
  NOT VALID;
