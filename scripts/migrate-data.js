// Dump data-only (public+auth+storage, hors tables de migration internes gérées par les
// services eux-mêmes) depuis SOURCE_DB_URL et restaure dans TARGET_DB_URL. Repris de la
// commande générée par `supabase db dump --dry-run` (docs/MIGRATION_SUPABASE_SELFHOST.md,
// Étape 4), avec les mêmes exclusions et flags. `storage.buckets` est aussi exclu : les
// buckets sont déjà créés par les migrations de schéma (Étape 2) — seule leur config
// (file_size_limit/allowed_mime_types) doit être synchronisée séparément, voir
// scripts/fix-schema-drift.sql.
//
// Nécessite pg_dump/psql dans le PATH — à exécuter depuis un environnement qui les a
// (ex: à l'intérieur du conteneur Postgres du docker-compose self-host, qui les embarque).
//
// Usage :
//   SOURCE_DB_URL=postgresql://... TARGET_DB_URL=postgresql://... node scripts/migrate-data.js

const { spawn, spawnSync } = require("child_process");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[migrate-data] Variable d'environnement manquante : ${name}`);
    process.exit(1);
  }
  return value;
}

const SOURCE_DB_URL = requireEnv("SOURCE_DB_URL");
const TARGET_DB_URL = requireEnv("TARGET_DB_URL");

for (const bin of ["pg_dump", "psql"]) {
  const check = spawnSync(bin, ["--version"]);
  if (check.error) {
    console.error(
      `[migrate-data] "${bin}" introuvable dans le PATH. À exécuter depuis un environnement ` +
        `disposant des outils client Postgres (ex: docker exec dans le conteneur Postgres du self-host).`
    );
    process.exit(1);
  }
}

const dumpArgs = [
  SOURCE_DB_URL,
  "--data-only",
  "--quote-all-identifier",
  "--exclude-table",
  "auth.schema_migrations",
  "--exclude-table",
  "storage.migrations",
  "--exclude-table",
  "supabase_functions.migrations",
  "--exclude-table",
  "storage.buckets",
  "--schema",
  "public|auth|storage",
  "--column-inserts",
  "--rows-per-insert",
  "100000",
];

// Idempotent : corrige la dérive de schéma (scripts/fix-schema-drift.sql) et vide les
// tables cibles avant de recharger, pour pouvoir relancer ce script à volonté sans
// jamais buter sur des clés déjà existantes d'un essai précédent.
const RESET_SQL = `
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
`;

console.log("[migrate-data] Correctifs de schéma + remise à zéro de la cible...");
const reset = spawnSync("psql", [TARGET_DB_URL, "-v", "ON_ERROR_STOP=1", "-c", RESET_SQL], {
  stdio: "inherit",
});
if (reset.status !== 0) {
  console.error("[migrate-data] Échec des correctifs/remise à zéro, arrêt avant le dump.");
  process.exit(reset.status || 1);
}

console.log("[migrate-data] Dump depuis la source, restauration dans la cible...");

const pgDump = spawn("pg_dump", dumpArgs);
const psql = spawn("psql", [TARGET_DB_URL, "-v", "ON_ERROR_STOP=1"], {
  stdio: ["pipe", "inherit", "inherit"],
});

psql.stdin.write("SET session_replication_role = replica;\n");

pgDump.stdout.on("data", (chunk) => {
  // Repris du sed de `supabase db dump` : neutralise les lignes \restrict / \unrestrict
  // émises par certaines versions de pg_dump (syntaxe psql meta-commande, pas du SQL).
  const text = chunk.toString().replace(/^\\(un)?restrict .*$/gm, (line) => `-- ${line}`);
  psql.stdin.write(text);
});

pgDump.stderr.on("data", (chunk) => process.stderr.write(chunk));

pgDump.on("close", (code) => {
  if (code !== 0) {
    console.error(`[migrate-data] pg_dump a échoué (code ${code}).`);
    psql.stdin.end();
    process.exit(code);
  }
  psql.stdin.write("RESET ALL;\n");
  psql.stdin.end();
});

psql.on("close", (code) => {
  if (code !== 0) {
    console.error(`[migrate-data] psql (restauration) a échoué (code ${code}).`);
    process.exit(code);
  }
  console.log("[migrate-data] Terminé.");
});
