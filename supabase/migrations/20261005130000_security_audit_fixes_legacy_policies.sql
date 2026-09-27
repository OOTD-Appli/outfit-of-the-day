-- OOTD — Suite immédiate de 20261005120000_security_audit_fixes.sql (2026-09-27, jour même).
--
-- Découvert en vérifiant la migration précédente en conditions réelles (comptes de test) :
-- deux policies héritées du Dashboard Supabase Cloud, jamais capturées dans aucune migration
-- versionnée (recréées "à l'identique" lors de la bascule self-host du 2026-08-12, voir
-- docs/MIGRATION_SUPABASE_SELFHOST.md, "15 policies manquantes"), coexistaient en parallèle
-- de "ootds_select_authenticated"/"likes_select_authenticated" et rendaient le correctif de
-- 20261005120000 inopérant : Postgres évalue toutes les policies SELECT d'une table en OU,
-- donc une seule policy USING (true) suffit à tout exposer, peu importe la rigueur des autres.
--
-- Vérifié par test réel (scripts/verify-security-migration.js) : un utilisateur tiers (aucun
-- lien d'amitié, aucune compétition partagée) voyait toujours une tenue is_public=false via
-- cette policy. Elle n'apparaît dans aucun fichier de supabase/migrations/ (créée à la main
-- sur le Dashboard Cloud d'origine) — sauvegarde de sa définition exacte avant suppression
-- dans backups/2026-09-27_191955/pre_migration_state.sql.
--
-- Pas de policy équivalente trouvée sur comments/flammes/friendships/profiles_private/snaps
-- (vérifié un par un via pg_policies) — ootds et likes sont les deux seules tables concernées.

DROP POLICY IF EXISTS "Lecture publique ootds" ON public.ootds;
DROP POLICY IF EXISTS "Lecture publique likes" ON public.likes;

NOTIFY pgrst, 'reload schema';
