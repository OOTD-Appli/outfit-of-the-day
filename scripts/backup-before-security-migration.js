// Sauvegarde avant application de supabase/migrations/20261005120000_security_audit_fixes.sql.
// Pas de pg_dump/Docker disponibles sur cette machine -> sauvegarde "logique" via le
// driver `pg` (npm install pg --no-save, non persisté dans package.json) :
//   1. Export ligne par ligne de TOUTES les tables du schéma public (backups/<horodatage>/data/*.json)
//   2. Définition SQL exacte AVANT migration de tout ce que la migration touche
//      (policies RLS, fonctions, triggers, grants) -> backups/<horodatage>/pre_migration_state.sql
//      pour un rollback ciblé et fidèle même sans pg_dump binaire complet.
//
// Usage : TARGET_DB_URL=postgresql://... node scripts/backup-before-security-migration.js

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const TARGET_DB_URL = process.env.TARGET_DB_URL;
if (!TARGET_DB_URL) {
  console.error('[backup] Variable TARGET_DB_URL manquante.');
  process.exit(1);
}

const STAMP = process.env.BACKUP_STAMP || 'manual';
const OUT_DIR = path.join(__dirname, '..', 'backups', STAMP);
const DATA_DIR = path.join(OUT_DIR, 'data');

const AFFECTED_TABLES_POLICIES = ['ootds', 'likes', 'comments', 'friendships', 'flammes'];
const AFFECTED_FUNCTIONS = [
  'profiles_guard_sensitive',
  'is_elite',
  'consume_daily_credit',
  'award_points_for_ootd',
  'buy_pass',
  'buy_cosmetic',
  'equip_cosmetic',
  'buy_pass_24h',
  'buy_flame_freeze',
  'use_flame_freeze',
  'restore_flamme',
  'claim_monthly_freezes',
  'toggle_message_like',
  'delete_message',
  'mark_messages_read',
  'increment_style_stats',
  'check_analyze_rate_limit',
];

function jsonSafe(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return { __buffer_base64__: value.toString('base64') };
  return value;
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const client = new Client({ connectionString: TARGET_DB_URL, ssl: false });
  await client.connect();

  console.log('[backup] === 1. Export des données (schema public) ===');
  const { rows: tables } = await client.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`
  );
  const counts = {};
  for (const { tablename } of tables) {
    const { rows } = await client.query(`select * from public.${client.escapeIdentifier(tablename)}`);
    const safeRows = rows.map((row) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) out[k] = jsonSafe(v);
      return out;
    });
    fs.writeFileSync(path.join(DATA_DIR, `${tablename}.json`), JSON.stringify(safeRows, null, 2));
    counts[tablename] = safeRows.length;
    console.log(`  ${tablename}: ${safeRows.length} ligne(s)`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'counts.json'), JSON.stringify(counts, null, 2));

  console.log('\n[backup] === 2. État SQL exact avant migration (policies/fonctions/grants) ===');
  const sqlParts = [
    `-- Etat AVANT application de 20261005120000_security_audit_fixes.sql`,
    `-- Genere le ${new Date().toISOString()} par scripts/backup-before-security-migration.js`,
    `-- A utiliser comme reference de rollback cible (pas un pg_dump binaire complet).`,
    ``,
  ];

  // Policies (definition CREATE POLICY reconstruite depuis pg_policies)
  for (const table of AFFECTED_TABLES_POLICIES) {
    const { rows: policies } = await client.query(
      `select policyname, permissive, roles, cmd, qual, with_check
       from pg_policies where schemaname = 'public' and tablename = $1
       order by policyname`,
      [table]
    );
    for (const p of policies) {
      const roles = Array.isArray(p.roles) ? p.roles.join(', ') : p.roles;
      const using = p.qual ? `\n  USING (${p.qual})` : '';
      const check = p.with_check ? `\n  WITH CHECK (${p.with_check})` : '';
      sqlParts.push(
        `-- Policy "${p.policyname}" sur public.${table} (AVANT migration)`,
        `DROP POLICY IF EXISTS "${p.policyname}" ON public.${table};`,
        `CREATE POLICY "${p.policyname}" ON public.${table} FOR ${p.cmd === '*' ? 'ALL' : p.cmd} TO ${roles}${using}${check};`,
        ``
      );
    }
  }

  // Fonctions (CREATE OR REPLACE FUNCTION exact via pg_get_functiondef)
  for (const fn of AFFECTED_FUNCTIONS) {
    const { rows } = await client.query(
      `select p.oid, pg_get_functiondef(p.oid) as def
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`,
      [fn]
    );
    for (const r of rows) {
      sqlParts.push(`-- Fonction public.${fn} (AVANT migration, oid ${r.oid})`, r.def + ';', ``);
      const { rows: acl } = await client.query(
        `select p.oid, p.proacl, pg_get_userbyid(p.proowner) as owner
         from pg_proc p where p.oid = $1`,
        [r.oid]
      );
      if (acl[0]) {
        sqlParts.push(
          `-- ACL brut avant migration (proacl) pour public.${fn} (oid ${r.oid}) : ${JSON.stringify(acl[0].proacl)}`,
          ``
        );
      }
    }
  }

  // Trigger profiles_guard_sensitive_trigger (definition exacte)
  const { rows: triggers } = await client.query(
    `select tgname, pg_get_triggerdef(t.oid) as def
     from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'profiles' and not t.tgisinternal`
  );
  for (const t of triggers) {
    sqlParts.push(`-- Trigger ${t.tgname} sur public.profiles (AVANT migration)`, t.def + ';', ``);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'pre_migration_state.sql'), sqlParts.join('\n'));

  await client.end();
  console.log(`\n[backup] Termine. Dossier : ${OUT_DIR}`);
}

main().catch((err) => {
  console.error('[backup] Erreur fatale :', err);
  process.exit(1);
});
