#!/usr/bin/env bash
# Version bash de scripts/migrate-data.js, pour les environnements sans Node (ex: le
# conteneur Postgres du docker-compose self-host, qui a pg_dump/psql mais pas Node).
# Idempotent : corrige la dérive de schéma (voir scripts/fix-schema-drift.sql) et vide
# les tables cibles avant de recharger, donc relançable à volonté sans conflit de clé.
#
# Usage :
#   SOURCE_DB_URL=postgresql://... TARGET_DB_URL=postgresql://... bash scripts/migrate-data.sh
set -euo pipefail

: "${SOURCE_DB_URL:?SOURCE_DB_URL manquant}"
: "${TARGET_DB_URL:?TARGET_DB_URL manquant}"

echo "[migrate-data] Correctifs de schema + remise a zero de la cible..."
psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 <<SQL
ALTER TABLE public.friendships ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.friendships DROP CONSTRAINT IF EXISTS friendships_id_key;
ALTER TABLE public.friendships ADD CONSTRAINT friendships_id_key UNIQUE (id);
ALTER TABLE public.profiles_private ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.snaps ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.snaps ADD COLUMN IF NOT EXISTS seen boolean DEFAULT false;
UPDATE storage.buckets SET file_size_limit = 4194304,
  allowed_mime_types = ARRAY['image/*','audio/mp4','audio/webm','audio/ogg','audio/mpeg','audio/x-m4a']
  WHERE id = 'ootds';
UPDATE storage.buckets SET file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/*','video/mp4']
  WHERE id = 'stories';
TRUNCATE
  auth.users,
  public.profiles, public.profiles_private, public.ootds, public.likes,
  public.comments, public.friendships, public.flammes, public.snaps,
  public.messages, public.stories, public.subscriptions,
  public.processed_payments, public.web_push_subscriptions, public.analyze_rate_limit
CASCADE;
SQL

echo "[migrate-data] Dump depuis la source, restauration dans la cible..."
{
  echo "SET session_replication_role = replica;"
  pg_dump "$SOURCE_DB_URL" \
    --data-only --quote-all-identifier \
    --exclude-table "auth.schema_migrations" \
    --exclude-table "storage.migrations" \
    --exclude-table "supabase_functions.migrations" \
    --exclude-table "storage.buckets" \
    --schema "public|auth|storage" \
    --column-inserts --rows-per-insert 100000 \
  | sed -E 's/^\\(un)?restrict .*$/-- &/'
  echo "RESET ALL;"
} | psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1

echo "[migrate-data] Termine."
