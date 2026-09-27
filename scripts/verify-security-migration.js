// Vérification post-migration de 20261005120000_security_audit_fixes.sql, en conditions
// réelles via l'API REST/Auth (comptes de test jetables, nettoyés à la fin).
//
// Usage : TARGET_URL=... TARGET_ANON_KEY=... TARGET_SERVICE_ROLE_KEY=... node scripts/verify-security-migration.js

const TARGET_URL = process.env.TARGET_URL;
const ANON_KEY = process.env.TARGET_ANON_KEY;
const SERVICE_KEY = process.env.TARGET_SERVICE_ROLE_KEY;

if (!TARGET_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('[verify] Variables manquantes (TARGET_URL / TARGET_ANON_KEY / TARGET_SERVICE_ROLE_KEY).');
  process.exit(1);
}

let PASS = 0;
let FAIL = 0;
function check(label, ok, detail) {
  if (ok) { PASS++; console.log(`  ✅ ${label}`); }
  else { FAIL++; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); }
}

async function adminCreateUser(email, password) {
  const res = await fetch(`${TARGET_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`admin create user ${email}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function signIn(email, password) {
  const res = await fetch(`${TARGET_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`signIn ${email}: ${res.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

async function adminDeleteUser(id) {
  await fetch(`${TARGET_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

function rest(jwt) {
  return async (pathAndQuery, opts = {}) => {
    const res = await fetch(`${TARGET_URL}/rest/v1/${pathAndQuery}`, {
      ...opts,
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        Prefer: opts.prefer || 'return=representation',
        ...(opts.headers || {}),
      },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

const STAMP = Date.now();
const users = {};

async function makeUser(label) {
  const email = `sectest_${STAMP}_${label}@ootd-verify.local`;
  const password = `Sect3st!${STAMP}`;
  const created = await adminCreateUser(email, password);
  const jwt = await signIn(email, password);
  const api = rest(jwt);
  const { status, data } = await api('profiles', {
    method: 'POST',
    body: JSON.stringify({ id: created.id, username: `${label}_${STAMP}`.slice(0, 40), active_logo: 'star' }),
  });
  users[label] = { id: created.id, email, jwt, api };
  return { ...users[label], profileStatus: status, profileData: data };
}

async function cleanup() {
  console.log('\n[verify] Nettoyage des comptes de test...');
  for (const label of Object.keys(users)) {
    try { await adminDeleteUser(users[label].id); console.log(`  supprimé: ${label}`); }
    catch (e) { console.log(`  échec suppression ${label}: ${e.message}`); }
  }
}

async function main() {
  console.log('[verify] Création des comptes de test (A, B, C = membre compétition, D = tiers)...');
  const A = await makeUser('a_owner');
  const B = await makeUser('b_stranger');
  const C = await makeUser('c_competition_member');
  const D = await makeUser('d_public_viewer');
  check('Profils créés (A/B/C/D)', [A, B, C, D].every((u) => u.profileStatus === 201), JSON.stringify({ A: A.profileData, B: B.profileData, C: C.profileData, D: D.profileData }));

  const scoreFields = { score_global: 75, score_couleurs: 70, score_coupe: 80, score_tendance: 75 };

  // --- 1. Tenue privée de A : B (tiers) ne doit PAS la voir ---
  const { data: privateOotd } = await A.api('ootds', {
    method: 'POST',
    body: JSON.stringify({ user_id: A.id, image_url: 'https://example.invalid/storage/v1/object/public/ootds/private.jpg', is_public: false, ...scoreFields }),
  });
  const privateOotdId = privateOotd?.[0]?.id;
  check('Tenue privée créée (A)', !!privateOotdId, JSON.stringify(privateOotd));

  const { data: bSeesPrivate } = await B.api(`ootds?id=eq.${privateOotdId}&select=id`);
  check('B (tiers) NE voit PAS la tenue privée de A', Array.isArray(bSeesPrivate) && bSeesPrivate.length === 0, JSON.stringify(bSeesPrivate));

  const { data: aSeesOwn } = await A.api(`ootds?id=eq.${privateOotdId}&select=id`);
  check('A (propriétaire) voit toujours sa propre tenue privée', Array.isArray(aSeesOwn) && aSeesOwn.length === 1);

  // --- 2. Amitié A<->C (accepted) requise par create_competition_with_members ---
  await A.api('friendships', { method: 'POST', body: JSON.stringify({ user_id: A.id, friend_id: C.id, status: 'pending' }) });
  const { data: acAccept } = await C.api(`friendships?user_id=eq.${A.id}&friend_id=eq.${C.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'accepted' }),
  });
  check('Amitié A<->C acceptée (prérequis compétition)', Array.isArray(acAccept) && acAccept[0]?.status === 'accepted', JSON.stringify(acAccept));

  // --- 3. Compétition (via RPC, comme le fait l'app) : A + C membres, PAS B ---
  const { data: compResult } = await A.api('rpc/create_competition_with_members', {
    method: 'POST',
    body: JSON.stringify({ p_name: `sectest-${STAMP}`, p_member_ids: [C.id] }),
  });
  const compId = compResult?.competition_id;
  check('Compétition créée (A+C membres)', compResult?.ok === true && !!compId, JSON.stringify(compResult));

  const { data: compOotdLink } = await A.api('ootd_competitions', {
    method: 'POST',
    body: JSON.stringify({ ootd_id: privateOotdId, competition_id: compId, user_id: A.id }),
  });
  check('Tenue privée liée à la compétition', Array.isArray(compOotdLink) && compOotdLink.length === 1, JSON.stringify(compOotdLink));

  const { data: cSeesCompOotd } = await C.api(`ootds?id=eq.${privateOotdId}&select=id`);
  check('C (membre de la compétition) VOIT la tenue is_public=false soumise', Array.isArray(cSeesCompOotd) && cSeesCompOotd.length === 1, JSON.stringify(cSeesCompOotd));

  const { data: bSeesCompOotd } = await B.api(`ootds?id=eq.${privateOotdId}&select=id`);
  check('B (pas membre de la compétition) NE voit toujours PAS la tenue', Array.isArray(bSeesCompOotd) && bSeesCompOotd.length === 0, JSON.stringify(bSeesCompOotd));

  // --- 4. Feed public : tenue is_public=true -> visible par un tiers (D) ---
  const { data: publicOotd } = await A.api('ootds', {
    method: 'POST',
    body: JSON.stringify({ user_id: A.id, image_url: 'https://example.invalid/storage/v1/object/public/ootds/public.jpg', is_public: true, ...scoreFields }),
  });
  const publicOotdId = publicOotd?.[0]?.id;
  const { data: dSeesPublic } = await D.api(`ootds?id=eq.${publicOotdId}&select=id`);
  check('D (tiers) voit la tenue publique de A', Array.isArray(dSeesPublic) && dSeesPublic.length === 1, JSON.stringify(dSeesPublic));

  await D.api('likes', { method: 'POST', body: JSON.stringify({ ootd_id: publicOotdId, user_id: D.id }) });
  const { data: bSeesLikeOnPublic } = await B.api(`likes?ootd_id=eq.${publicOotdId}&select=id`);
  check('Les likes sur la tenue publique restent visibles par tous', Array.isArray(bSeesLikeOnPublic) && bSeesLikeOnPublic.length === 1, JSON.stringify(bSeesLikeOnPublic));

  // --- 5. Classements ---
  const { status: topAppStatus, data: topApp } = await A.api('rpc/get_top3_app', { method: 'POST', body: JSON.stringify({ p_period: 'day' }) });
  check('get_top3_app répond sans erreur', topAppStatus === 200, `status=${topAppStatus} ${JSON.stringify(topApp)}`);

  const { status: leaderboardStatus, data: leaderboard } = await A.api('rpc/get_competition_leaderboard', {
    method: 'POST',
    body: JSON.stringify({ p_competition_id: compId, p_period: 'day' }),
  });
  check('get_competition_leaderboard répond sans erreur', leaderboardStatus === 200, `status=${leaderboardStatus} ${JSON.stringify(leaderboard)}`);

  // --- 6. set_analysis_personality : tier gating fonctionnel ---
  const { status: coachStatus, data: coachResult } = await A.api('rpc/set_analysis_personality', {
    method: 'POST', body: JSON.stringify({ p_key: 'coach' }),
  });
  check('set_analysis_personality("coach", gratuit) -> ok', coachStatus === 200 && coachResult?.ok === true, `status=${coachStatus} ${JSON.stringify(coachResult)}`);

  const { status: eliteStatus, data: eliteResult } = await A.api('rpc/set_analysis_personality', {
    method: 'POST', body: JSON.stringify({ p_key: 'pote_hype' }),
  });
  check('set_analysis_personality("pote_hype", gratuit) -> refusé (verrouillé)', eliteStatus === 200 && eliteResult?.ok === false, `status=${eliteStatus} ${JSON.stringify(eliteResult)}`);

  // --- 7. friendships : forge d'identité bloquée (B tente de détourner vers D pendant l'acceptation) ---
  await A.api('friendships', { method: 'POST', body: JSON.stringify({ user_id: A.id, friend_id: B.id, status: 'pending' }) });
  const { data: forged } = await B.api(`friendships?user_id=eq.${A.id}&friend_id=eq.${B.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'accepted', friend_id: D.id }),
  });
  const stillPointsToB = Array.isArray(forged) && forged.length === 1 && forged[0].friend_id === B.id && forged[0].status === 'accepted';
  check('friendships : identité figée (friend_id non détournable via UPDATE)', stillPointsToB, JSON.stringify(forged));

  console.log(`\n[verify] Résultat : ${PASS} OK / ${FAIL} échec(s)`);
  if (FAIL > 0) process.exitCode = 1;
}

main()
  .catch((err) => { console.error('[verify] Erreur fatale :', err); process.exitCode = 1; })
  .finally(cleanup);
