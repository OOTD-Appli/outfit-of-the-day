-- Corrige la dérive de schéma découverte le 2026-08-12 entre les migrations versionnées
-- (utilisées pour créer la cible self-host à l'Étape 2) et le schéma réellement en
-- production sur Supabase Cloud. La migration `20260528100000_security_hardening.sql`
-- (et d'autres) ont introduit des colonnes NOT NULL / types plus stricts / une table
-- `friendships` redessinée (clé primaire composite au lieu d'un `id`) qui n'ont
-- apparemment jamais été appliqués sur le projet Cloud réel — probablement silencieusement
-- ignorés (traces de `DROP TRIGGER/POLICY IF EXISTS ... does not exist, skipping`
-- dans les logs d'application de cette même migration).
--
-- Vérifié sur les vraies données de prod (2026-08-12, lecture seule) : AUCUNE ligne ne
-- viole les contraintes plus strictes de la cible (0 NULL, 0 auto-amitié, 0 désordre
-- flammes). Seules 3 colonnes manquent réellement côté cible et bloquent le dump/restore
-- avec une erreur "column ... does not exist" : friendships.id, profiles_private.updated_at,
-- snaps.message, snaps.seen. On les ajoute sans toucher au reste (les contraintes plus
-- strictes déjà en place sur la cible sont conservées, les vraies données les respectent).
--
-- À exécuter sur la cible (self-host) avant de relancer scripts/migrate-data.js.

ALTER TABLE public.friendships ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.friendships ADD CONSTRAINT friendships_id_key UNIQUE (id);

ALTER TABLE public.profiles_private ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.snaps ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.snaps ADD COLUMN IF NOT EXISTS seen boolean DEFAULT false;

-- Remet à zéro les tables partiellement chargées par la tentative précédente
-- (interrompue sur l'erreur friendships.id) pour repartir sur un chargement propre.
-- Sans risque : la cible ne sert encore aucun trafic réel (rehearsal Étape 4).
TRUNCATE
  auth.users,
  public.profiles, public.profiles_private, public.ootds, public.likes,
  public.comments, public.friendships, public.flammes, public.snaps,
  public.messages, public.stories, public.subscriptions,
  public.processed_payments, public.web_push_subscriptions, public.analyze_rate_limit
CASCADE;
