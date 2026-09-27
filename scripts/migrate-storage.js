// Copie les fichiers des buckets Storage depuis le projet Supabase Cloud source
// vers l'instance self-host cible, en préservant l'arborescence exacte des chemins
// (les URLs publiques stockées en base — ootds.image_url, messages.image_url, etc. —
// dépendent de <uid>/<fichier> et ne doivent pas changer).
//
// Usage :
//   SOURCE_URL=https://jjqisirnrodilxfkcbiq.supabase.co \
//   SOURCE_SERVICE_KEY=<service_role_source> \
//   TARGET_URL=https://supabase.myback.fr \
//   TARGET_SERVICE_KEY=<service_role_cible> \
//   node scripts/migrate-storage.js [bucket1,bucket2,...]
//
// Sans argument, migre les 3 buckets dans l'ordre recommandé par le plan :
// avatars (rapide à valider) -> ootds (gros volume) -> stories (TTL 24h, le volume
// perdu pendant la fenêtre de maintenance n'a pas besoin d'être rattrapé).
//
// Le script est idempotent : relançable sans dupliquer (upload avec upsert), donc
// interruptible et reprenable en cas de coupure réseau sur un gros bucket.

const { createClient } = require('@supabase/supabase-js');

const DEFAULT_BUCKETS = ['avatars', 'ootds', 'stories'];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[migrate-storage] Variable d'environnement manquante : ${name}`);
    process.exit(1);
  }
  return value;
}

const SOURCE_URL = requireEnv('SOURCE_URL');
const SOURCE_SERVICE_KEY = requireEnv('SOURCE_SERVICE_KEY');
const TARGET_URL = requireEnv('TARGET_URL');
const TARGET_SERVICE_KEY = requireEnv('TARGET_SERVICE_KEY');

const buckets = (process.argv[2] ? process.argv[2].split(',') : DEFAULT_BUCKETS)
  .map((b) => b.trim())
  .filter(Boolean);

const source = createClient(SOURCE_URL, SOURCE_SERVICE_KEY, {
  auth: { persistSession: false },
});
const target = createClient(TARGET_URL, TARGET_SERVICE_KEY, {
  auth: { persistSession: false },
});

// Liste récursive : l'API Storage `.list()` n'est pas récursive nativement,
// on descend manuellement dans chaque "dossier" (entrée sans `id` = dossier).
async function listAllPaths(client, bucket, prefix = '') {
  const paths = [];
  const { data, error } = await client.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) {
    throw new Error(`list(${bucket}, "${prefix}") : ${error.message}`);
  }
  for (const entry of data ?? []) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      // Dossier (pas de metadata id) -> descendre
      const nested = await listAllPaths(client, bucket, fullPath);
      paths.push(...nested);
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

async function migrateBucket(bucket) {
  console.log(`\n[migrate-storage] === Bucket "${bucket}" ===`);

  const paths = await listAllPaths(source, bucket);
  console.log(`[migrate-storage] ${paths.length} fichier(s) trouvé(s) dans la source.`);

  let ok = 0;
  let failed = 0;
  const failures = [];

  for (const [index, path] of paths.entries()) {
    process.stdout.write(
      `[migrate-storage] (${index + 1}/${paths.length}) ${path} ... `
    );
    try {
      const { data: blob, error: downloadError } = await source.storage
        .from(bucket)
        .download(path);
      if (downloadError) throw downloadError;

      const arrayBuffer = await blob.arrayBuffer();
      const contentType = blob.type || 'application/octet-stream';

      const { error: uploadError } = await target.storage
        .from(bucket)
        .upload(path, Buffer.from(arrayBuffer), {
          contentType,
          upsert: true,
        });
      if (uploadError) throw uploadError;

      ok += 1;
      console.log('OK');
    } catch (err) {
      failed += 1;
      failures.push({ path, error: err.message || String(err) });
      console.log(`ÉCHEC (${err.message || err})`);
    }
  }

  console.log(
    `[migrate-storage] Bucket "${bucket}" terminé : ${ok} OK, ${failed} échec(s).`
  );
  return { bucket, total: paths.length, ok, failed, failures };
}

async function main() {
  console.log(`[migrate-storage] Source : ${SOURCE_URL}`);
  console.log(`[migrate-storage] Cible  : ${TARGET_URL}`);
  console.log(`[migrate-storage] Buckets: ${buckets.join(', ')}`);

  const results = [];
  for (const bucket of buckets) {
    results.push(await migrateBucket(bucket));
  }

  console.log('\n[migrate-storage] === Résumé ===');
  let anyFailure = false;
  for (const r of results) {
    console.log(`  ${r.bucket}: ${r.ok}/${r.total} OK`);
    if (r.failed > 0) {
      anyFailure = true;
      console.log(`    échecs (${r.failed}) :`);
      for (const f of r.failures) {
        console.log(`      - ${f.path}: ${f.error}`);
      }
    }
  }

  if (anyFailure) {
    console.log(
      '\n[migrate-storage] Relancer le script (idempotent, upsert) pour retenter les échecs.'
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[migrate-storage] Erreur fatale :', err);
  process.exit(1);
});
