// OOTD — Edge Function : create-portal-session
// Ouvre le Portail Client Stripe (Customer Portal) pour gérer / résilier l'abonnement.
// Renvoie l'URL du portail à ouvrir dans le navigateur.
//
// ─── Configuration ───────────────────────────────────────────────────────────
//   STRIPE_SECRET_KEY : clé secrète Stripe
//   APP_REDIRECT_URL  : (optionnel) retour vers l'app. Défaut : ootd://shop
//   (Active le Customer Portal dans Stripe : Dashboard → Settings → Billing → Customer portal)
//
// `supabase functions deploy create-portal-session`

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

// APP_ORIGIN accepte une liste d'origines séparées par des virgules (multi-domaines :
// ancien + nouveau nom de marque, + localhost en dev) — on renvoie l'origine de la
// requête si elle y figure, jamais '*' en présence d'Authorization.
const ALLOWED_ORIGINS = (Deno.env.get('APP_ORIGIN') ?? '')
  .split(',').map((o) => o.trim()).filter(Boolean);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] ?? '*');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

serve(async (req: Request) => {
  const CORS = corsHeadersFor(req);
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Non authentifié' }, 401);

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ error: 'Stripe non configuré (STRIPE_SECRET_KEY)' }, 500);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Session invalide ou expirée' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: sub } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      return json({ error: 'Aucun abonnement à gérer' }, 404);
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Web : retour sur le domaine d'origine de l'appelant (validé contre la liste
    // ALLOWED_ORIGINS) plutôt qu'un domaine unique en dur. Natif : deep link ootd://.
    const callerOrigin = req.headers.get('Origin') ?? '';
    const webReturnBase = ALLOWED_ORIGINS.includes(callerOrigin) ? callerOrigin : null;
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: webReturnBase ?? (Deno.env.get('APP_REDIRECT_URL') ?? 'ootd://shop'),
    });

    return json({ url: portal.url }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur interne' }, 500);
  }
});
