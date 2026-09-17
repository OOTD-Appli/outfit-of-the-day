-- OOTD — Nettoyage final Compétitions v2 : purge complète des Stories (2026-09-22)
-- Décision produit validée : suppression définitive (pas juste un arrêt
-- d'écriture) — table, bucket Storage et job pg_cron. Le code client a déjà
-- cessé de lire/écrire ce bucket/cette table (retiré d'AccueilScreen.js).

-- 1. Stoppe le job avant de toucher au reste (évite une exécution concurrente
--    à mi-chemin de la suppression).
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-expired-stories');
EXCEPTION WHEN OTHERS THEN NULL; -- ok si pg_cron désactivé ou job déjà absent
END $$;

-- 2. Trigger + fonctions de nettoyage Storage liées aux stories
DROP TRIGGER IF EXISTS trg_delete_story_files ON public.stories;
DROP FUNCTION IF EXISTS public.delete_story_files();
DROP FUNCTION IF EXISTS public.cleanup_expired_stories();

-- 3. Fichiers + bucket : NE PAS faire ça en SQL brut — cette instance refuse
--    DELETE FROM storage.objects (ERROR 42501, "Direct deletion from storage
--    tables is not allowed. Use the Storage API instead."). Fait séparément
--    via l'API Storage (15 fichiers orphelins retrouvés et supprimés, puis
--    DELETE /storage/v1/bucket/stories) avant d'exécuter cette migration.

-- 4. Table (cascade automatiquement policies/index restants)
DROP TABLE IF EXISTS public.stories;
