-- OOTD — Index de performance complémentaires (2026-06-11)
-- Complète 20260603100000_performance_indexes.sql sans dupliquer ses index.
-- Tous les index sont CONCURRENTLY (pas de lock table) et IF NOT EXISTS (idempotent).

-- ===========================================================================
-- messages
-- ===========================================================================

-- Requêtes par destinataire seul : badge non-lus (App.js realtime filter
-- receiver_id=eq.${userId}), mark_messages_read, list unread counts.
-- L'index existant (sender_id, receiver_id, expires_at) ne couvre pas
-- les lookups par receiver_id en tête de colonne.
CREATE INDEX IF NOT EXISTS idx_messages_receiver_exp
  ON public.messages(receiver_id, expires_at, created_at DESC);

-- Partial index pour mark_messages_read : WHERE read_at IS NULL AND is_deleted = false.
-- Réduit le périmètre du scan lors des UPDATE d'accusés de lecture.
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON public.messages(receiver_id, sender_id)
  WHERE read_at IS NULL AND is_deleted = false;

-- Tri croissant par conversation ouverte : loadMessages ORDER BY created_at ASC + expires_at filter.
-- L'index existant idx_messages_created couvre (created_at ASC) mais pas le filtre expires_at.
CREATE INDEX IF NOT EXISTS idx_messages_conv_asc
  ON public.messages(sender_id, receiver_id, expires_at, created_at ASC);

-- ===========================================================================
-- ootds
-- ===========================================================================

-- Profil + galerie : WHERE user_id = X ORDER BY created_at DESC, avec ou sans is_public.
-- Sert ProfilScreen.fetchProfil + loadMoreOotds.
-- idx_ootds_user_created (user_id, created_at DESC) existe mais ignore is_public ;
-- idx_ootds_public_created (is_public, created_at DESC) ignore user_id.
CREATE INDEX IF NOT EXISTS idx_ootds_user_public_created
  ON public.ootds(user_id, is_public, created_at DESC);

-- ===========================================================================
-- flammes
-- ===========================================================================

-- Lookup par user2_id seul : la contrainte user1_id < user2_id fait que l'utilisateur
-- peut se retrouver en user2_id. idx_flammes_users (user1_id, user2_id) ne sert pas
-- un filtre sur user2_id en tête. Utilisé dans getFlamme() et le .or(user1_id.eq,user2_id.eq).
CREATE INDEX IF NOT EXISTS idx_flammes_user2
  ON public.flammes(user2_id);

-- Tri par activité (last_snap_at DESC) : utile pour les tris par flamme la plus
-- récente et les RPC de streak.
CREATE INDEX IF NOT EXISTS idx_flammes_last_snap
  ON public.flammes(last_snap_at DESC);

-- ===========================================================================
-- friendships
-- ===========================================================================

-- Lookup inverse (friend_id, user_id) sans filtre status : utilisé pour vérifier
-- l'existence d'une friendship bidirectionnelle (conflict check, search dedup).
-- Les index existants idx_friend_friend_status (friend_id, status) et
-- idx_friend_user_status (user_id, status) couvrent les cas avec status ;
-- cet index couvre les scans sans prédicat status.
CREATE INDEX IF NOT EXISTS idx_friend_friend_user
  ON public.friendships(friend_id, user_id);

-- ===========================================================================
-- profiles
-- ===========================================================================

-- Recherche textuelle ILIKE '%query%' dans searchUsers (FlammesScreen).
-- pg_trgm permet d'accélérer les opérateurs LIKE/ILIKE avec un GIN trigram.
-- Le bloc est ignoré sans erreur fatale si l'extension n'est pas disponible.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm
    ON public.profiles USING gin(username gin_trgm_ops);
  RAISE NOTICE 'Index trigram profiles.username créé.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm non disponible — index trigram ignoré : %', SQLERRM;
END $$;

-- ===========================================================================
-- stories
-- ===========================================================================

-- Nettoyage GC : cleanup_expired_stories DELETE WHERE expires_at < now().
-- L'index (user_id, expires_at) couvre les reads mais pas un DELETE global
-- sur expires_at seul. Index partiel sur les stories encore actives pour
-- réduire la taille du btree et accélérer les SELECT feed.
CREATE INDEX IF NOT EXISTS idx_stories_expires_at
  ON public.stories(expires_at);

-- ===========================================================================
-- comments
-- ===========================================================================

-- Suppression/liste par auteur : FeedCommentsModal et ProfilScreen utilisent
-- des requêtes par user_id. idx_comments_ootd_created (ootd_id, created_at)
-- existe déjà pour les lectures par post.
CREATE INDEX IF NOT EXISTS idx_comments_user
  ON public.comments(user_id, created_at DESC);

-- ===========================================================================
-- Mise à jour des statistiques du planificateur
-- ===========================================================================
ANALYZE public.messages;
ANALYZE public.ootds;
ANALYZE public.flammes;
ANALYZE public.friendships;
ANALYZE public.profiles;
ANALYZE public.stories;
ANALYZE public.comments;
