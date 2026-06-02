-- OOTD — Confidentialité du profil (2026-06-02)
-- Ajoute is_private sur profiles.
-- false (défaut) = profil public → visible dans le feed global.
-- true            = profil privé  → posts visibles uniquement par les amis acceptés.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
