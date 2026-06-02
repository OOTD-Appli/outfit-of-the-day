-- Correction contrainte messages_has_content (2026-06-02)
-- La contrainte originale CHECK (content IS NOT NULL OR image_url IS NOT NULL)
-- bloque le soft-delete qui pose content=NULL et image_url=NULL.
-- On l'exempte quand is_deleted=true.

ALTER TABLE public.messages
  DROP CONSTRAINT messages_has_content;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_has_content
    CHECK (is_deleted = true OR content IS NOT NULL OR image_url IS NOT NULL);
