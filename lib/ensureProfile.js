import { supabase } from './supabase';

/**
 * Garantit une ligne public.profiles pour l’utilisateur connecté.
 * Utile si l’inscription avec confirmation e-mail n’avait pas de session (insert profil bloqué par RLS),
 * ou si l’insert initial a échoué sans affichage d’erreur.
 */
export async function ensureUserProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: true, skipped: true };

  const { data: existing, error: readErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (readErr) return { ok: false, error: readErr };
  if (existing) return { ok: true, created: false };

  const meta = user.user_metadata || {};
  const preferred = (meta.username && String(meta.username).trim()) || '';
  const suffix = user.id.replace(/-/g, '').slice(0, 8);

  const tryInsert = async (uname) => {
    const u = String(uname || '').trim().slice(0, 40);
    if (!u) return { error: { message: 'pseudo vide' } };
    return supabase.from('profiles').insert({ id: user.id, username: u, active_logo: 'star' });
  };

  if (preferred) {
    const { error: e1 } = await tryInsert(preferred);
    if (!e1) return { ok: true, created: true };
    if (e1.code !== '23505') return { ok: false, error: e1 };
  }

  let base = preferred;
  if (!base && user.email) {
    base = user.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 20);
  }
  if (!base) base = 'user';

  const candidate = `${base}_${suffix}`.slice(0, 40);
  const { error: insErr } = await tryInsert(candidate);

  if (insErr) {
    if (insErr.code === '23505') {
      const fallback = `user_${suffix}`;
      const { error: e2 } = await tryInsert(fallback);
      if (e2) return { ok: false, error: e2 };
      return { ok: true, created: true };
    }
    return { ok: false, error: insErr };
  }

  return { ok: true, created: true };
}
