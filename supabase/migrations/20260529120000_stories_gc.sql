-- Garbage collector pour les stories expirées
-- ─────────────────────────────────────────────────────────────
-- INSTRUCTIONS D'EXÉCUTION
-- Coller ce fichier entier dans le SQL Editor de Supabase.
-- Les parties 1-3 s'exécutent sans pré-requis.
-- La partie 4 (pg_cron) nécessite d'activer l'extension d'abord :
--   Dashboard → Database → Extensions → pg_cron → Enable
-- Si pg_cron n'est pas activé, la partie 4 est ignorée silencieusement.
-- ─────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────
-- 1. Fonction du trigger : supprime les fichiers Storage
--    quand une ligne stories est effacée.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_story_files()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_path text;
BEGIN
  BEGIN
    -- URL stockée : https://<project>.supabase.co/storage/v1/object/public/stories/<uid>/<ts>.mp4
    -- Chemin dans storage.objects.name : <uid>/<ts>.mp4
    IF OLD.video_url IS NOT NULL THEN
      v_path := regexp_replace(
        OLD.video_url,
        '^https?://[^/]+/storage/v1/object/public/stories/',
        ''
      );
      IF v_path IS DISTINCT FROM OLD.video_url THEN
        DELETE FROM storage.objects
        WHERE bucket_id = 'stories' AND name = v_path;
      END IF;
    END IF;

    IF OLD.image_url IS NOT NULL THEN
      v_path := regexp_replace(
        OLD.image_url,
        '^https?://[^/]+/storage/v1/object/public/stories/',
        ''
      );
      IF v_path IS DISTINCT FROM OLD.image_url THEN
        DELETE FROM storage.objects
        WHERE bucket_id = 'stories' AND name = v_path;
      END IF;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Ne jamais bloquer le DELETE stories si le fichier est introuvable ou l'URL malformée.
    RAISE WARNING '[stories_gc] Suppression storage échouée pour story % : %',
      OLD.id, SQLERRM;
  END;

  RETURN OLD;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 2. Trigger sur la table stories
-- ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_delete_story_files ON public.stories;

CREATE TRIGGER trg_delete_story_files
  AFTER DELETE ON public.stories
  FOR EACH ROW
  EXECUTE FUNCTION public.delete_story_files();

-- ─────────────────────────────────────────────────────────────
-- 3. Fonction de nettoyage : efface toutes les stories expirées
--    Appel manuel possible : SELECT public.cleanup_expired_stories();
--    Retourne le nombre de lignes supprimées.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_expired_stories()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.stories WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_expired_stories() TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_story_files()       TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 4. Planification automatique via pg_cron (optionnel)
--    Pré-requis : pg_cron doit être activé dans Dashboard → Extensions.
--    Si l'extension est absente, ce bloc est ignoré sans erreur.
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Supprime un job éventuel du même nom pour éviter les doublons
  PERFORM cron.unschedule('cleanup-expired-stories');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule(
    'cleanup-expired-stories',
    '5 * * * *',
    'SELECT public.cleanup_expired_stories()'
  );
  RAISE NOTICE 'pg_cron job "cleanup-expired-stories" planifié (toutes les heures à :05).';
EXCEPTION WHEN undefined_schema OR undefined_table THEN
  RAISE NOTICE 'pg_cron non activé — activer l''extension dans Dashboard > Extensions, puis relancer la partie 4.';
WHEN OTHERS THEN
  RAISE NOTICE 'Erreur pg_cron : %. Activer l''extension et réessayer.', SQLERRM;
END $$;
