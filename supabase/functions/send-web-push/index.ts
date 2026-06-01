// OOTD — Edge Function : send-web-push
// Envoie une notification Web Push aux abonnements (navigateur) du destinataire.
// Sécurité : appelant authentifié + amitié acceptée requise (anti-spam).
//
// ─── Secrets ─────────────────────────────────────────────────────────────────
//   VAPID_PUBLIC_KEY  / VAPID_PRIVATE_KEY  : paire VAPID (web-push generate-vapid-keys)
//   VAPID_SUBJECT     : mailto:... (contact du projet)
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY : injectés
//
// `supabase functions deploy send-web-push`

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Non authentifié' }, 401);

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@ootd.app';
  if (!vapidPublic || !vapidPrivate) return json({ error: 'VAPID non configuré' }, 500);

  try {
    const body = await req.json().catch(() => null);
    const recipientId = body?.recipient_id;
    const title = (body?.title ?? 'OOTD').toString().slice(0, 100);
    const message = (body?.body ?? '').toString().slice(0, 240);
    const url = (body?.url ?? '/').toString();
    if (!recipientId || typeof recipientId !== 'string') {
      return json({ error: 'recipient_id manquant' }, 400);
    }

    // Identité de l'appelant
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Session invalide' }, 401);
    if (user.id === recipientId) return json({ sent: 0, skipped: 'self' }, 200);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Anti-spam : exige une amitié acceptée entre l'appelant et le destinataire
    const { data: friendship } = await admin
      .from('friendships')
      .select('id')
      .eq('status', 'accepted')
      .or(
        `and(user_id.eq.${user.id},friend_id.eq.${recipientId}),` +
        `and(user_id.eq.${recipientId},friend_id.eq.${user.id})`,
      )
      .limit(1)
      .maybeSingle();
    if (!friendship) return json({ error: 'Non autorisé (pas amis)' }, 403);

    const { data: subs } = await admin
      .from('web_push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', recipientId);

    if (!subs || subs.length === 0) return json({ sent: 0 }, 200);

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const payload = JSON.stringify({ title, body: message, url });

    let sent = 0;
    const dead: string[] = [];
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // abonnement expiré
      }
    }
    // Purge des abonnements morts
    if (dead.length) await admin.from('web_push_subscriptions').delete().in('id', dead);

    return json({ sent, removed: dead.length }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur interne' }, 500);
  }
});
