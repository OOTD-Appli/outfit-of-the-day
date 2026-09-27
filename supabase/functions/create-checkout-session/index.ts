// OOTD — Edge Function : create-checkout-session
// Crée une session Stripe Checkout (mode subscription) pour les plans 'plus' ou 'elite'
// et renvoie l'URL de paiement à ouvrir dans le navigateur.
//
// ─── Configuration des secrets (Dashboard Supabase → Edge Functions → Secrets) ───
//   STRIPE_SECRET_KEY     : clé secrète Stripe (sk_live_… ou sk_test_…)
//   STRIPE_PRICE_PLUS     : ID du prix récurrent du plan OOTD Plus  (price_…, 2,99€/mois)
//   STRIPE_PRICE_ELITE    : ID du prix récurrent du plan OOTD Elite (price_…, 4,99€/mois)
//   APP_REDIRECT_URL      : (optionnel) URL/scheme de retour. Défaut : ootd://shop
//   SUPABASE_URL          : injecté automatiquement par Supabase
//   SUPABASE_ANON_KEY     : injecté automatiquement par Supabase
//   SUPABASE_SERVICE_ROLE_KEY : injecté automatiquement par Supabase
//
// `supabase functions deploy create-checkout-session`

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

const PLAN_PRICE_ENV: Record<string, string> = {
  plus:  'STRIPE_PRICE_PLUS',
  elite: 'STRIPE_PRICE_ELITE',
};

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

    const body = await req.json().catch(() => null);
    const planType = body?.plan_type;
    if (planType !== 'plus' && planType !== 'elite') {
      return json({ error: 'plan_type invalide (plus | elite)' }, 400);
    }

    const priceId = Deno.env.get(PLAN_PRICE_ENV[planType]);
    if (!priceId) return json({ error: `Prix Stripe non configuré (${PLAN_PRICE_ENV[planType]})` }, 500);

    // Identité de l'appelant (RLS appliqué via son JWT)
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Session invalide ou expirée' }, 401);

    // Client service_role pour lire/écrire la table subscriptions (hors RLS)
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Récupère ou crée le client Stripe pour cet utilisateur
    const { data: existing } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      // Pré-enregistre le mapping user ↔ customer (statut inactif tant que non payé)
      await admin.from('subscriptions').upsert(
        { user_id: user.id, stripe_customer_id: customerId, status: 'inactive' },
        { onConflict: 'user_id' },
      );
    }

    // Web : retour sur le domaine d'origine de l'appelant (validé contre la liste
    // ALLOWED_ORIGINS) plutôt qu'un domaine unique en dur — marche pour l'ancien ET le
    // nouveau nom de marque. Natif (pas d'en-tête Origin) : deep link ootd:// inchangé.
    const callerOrigin = req.headers.get('Origin') ?? '';
    const webReturnBase = ALLOWED_ORIGINS.includes(callerOrigin) ? callerOrigin : null;
    const redirectBase = webReturnBase ?? (Deno.env.get('APP_REDIRECT_URL') ?? 'ootd://shop');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      // Métadonnées lues par le webhook pour relier l'abonnement à l'utilisateur
      subscription_data: {
        metadata: { supabase_user_id: user.id, plan_type: planType },
      },
      metadata: { supabase_user_id: user.id, plan_type: planType },
      success_url: `${redirectBase}?status=success`,
      cancel_url: `${redirectBase}?status=cancelled`,
    });

    return json({ url: session.url }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur interne' }, 500);
  }
});
