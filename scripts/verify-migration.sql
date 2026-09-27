-- Vérification post-migration (Étapes 2, 4, 9 de docs/MIGRATION_SUPABASE_SELFHOST.md).
-- À exécuter TEL QUEL sur la source (Supabase Cloud) puis sur la cible (self-host),
-- via psql ou le SQL Editor, et comparer les deux résultats ligne par ligne.
--
--   psql "<CONNECTION_STRING>" -f scripts/verify-migration.sql

-- 1. pg_cron actif + job de purge des stories enregistré (Étape 2)
select extname, extversion from pg_extension where extname = 'pg_cron';
select jobid, schedule, command, active from cron.job;

-- 2. Comptage des tables principales (Étape 4) — les deux lignes doivent matcher
-- entre source et cible après le pg_dump/pg_restore --data-only.
select 'auth.users' as table_name, count(*) from auth.users
union all
select 'public.profiles', count(*) from public.profiles
union all
select 'public.ootds', count(*) from public.ootds
union all
select 'public.likes', count(*) from public.likes
union all
select 'public.comments', count(*) from public.comments
union all
select 'public.friendships', count(*) from public.friendships
union all
select 'public.flammes', count(*) from public.flammes
union all
select 'public.snaps', count(*) from public.snaps
union all
select 'public.messages', count(*) from public.messages
union all
select 'public.stories', count(*) from public.stories
union all
select 'public.subscriptions', count(*) from public.subscriptions
union all
select 'public.processed_payments', count(*) from public.processed_payments
union all
select 'public.web_push_subscriptions', count(*) from public.web_push_subscriptions
union all
select 'public.profiles_private', count(*) from public.profiles_private
union all
select 'public.analyze_rate_limit', count(*) from public.analyze_rate_limit
order by table_name;

-- 3. Métadonnées Storage par bucket (à comparer avec le nombre réel de fichiers
-- copiés par scripts/migrate-storage.js une fois l'Étape 5 terminée)
select bucket_id, count(*) as objects
from storage.objects
group by bucket_id
order by bucket_id;

-- 4. Job pg_cron : vérifier après l'heure programmée qu'une exécution a bien eu lieu
-- (à relancer après la fenêtre de test de l'Étape 9, pas immédiatement après le dump)
select jobid, runid, status, start_time, end_time
from cron.job_run_details
order by start_time desc
limit 10;
