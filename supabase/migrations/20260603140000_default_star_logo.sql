-- OOTD — Logo étoile par défaut (2026-06-03)
-- Attribue l'étoile classique (logo gratuit) aux profils sans logo équipé.
-- Le trigger profiles_guard_sensitive bloque les UPDATE client sur active_logo ;
-- cette migration tourne en tant que postgres (superuser) et ne passe pas par
-- le canal client → la protection RLS/trigger ne s'applique pas ici.

ALTER TABLE public.profiles
  ALTER COLUMN active_logo SET DEFAULT 'star';

UPDATE public.profiles
   SET active_logo = 'star'
 WHERE active_logo IS NULL;
