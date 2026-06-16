-- Étend la contrainte messages_has_content pour autoriser les messages vocaux
-- (audio_url IS NOT NULL suffit à valider la ligne, sans content ni image_url).

ALTER TABLE public.messages
  DROP CONSTRAINT messages_has_content;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_has_content
    CHECK (
      is_deleted = true
      OR content   IS NOT NULL
      OR image_url IS NOT NULL
      OR audio_url IS NOT NULL
    );
