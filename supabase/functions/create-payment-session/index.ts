// OOTD — Edge Function : create-payment-session
// Crée une session Stripe Checkout en mode `payment` (achat unique, ≠ abonnement)
// pour les achats express en euros, et renvoie l'URL de paiement.
//
// ─── Secrets (Dashboard Supabase → Edge Functions → Secrets) ─────────────────
//   STRIPE_SECRET_KEY          : clé secrète Stripe
//   STRIPE_PRICE_FLAME_FREEZE  : prix one-time du Gel de Flamme   (0,99€)
//   STRIPE_PRICE_POINTS_2000   : prix one-time du Pack 2000 points (0,99€)
//   APP_REDIRECT_URL           : (optionnel) retour app. Défaut : ootd://shop
//
// Le crédit réel (points / gel) est posé par le webhook (checkout.session.completed),
// jamais ici : cette fonction ne fait qu'ouvrir le paiement.
//
// `supabase functions deploy create-payment-session`

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const ORIGIN = Deno.env.get('APP_ORIGIN') ?? '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Produit logique → variable d'env du prix Stripe correspondant
const PRODUCT_PRICE_ENV: Record<string, string> = {
  flame_freeze: 'STRIPE_PRICE_FLAME_FREEZE',
  points_2000:  'STRIPE_PRICE_POINTS_2000',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Non authentifié' }, 401);

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) return json({ error: 'Stripe non configuré (STRIPE_SECRET_KEY)' }, 500);

    const body = await req.json().catch(() => null);
    const product = body?.product;
    if (product !== 'flame_freeze' && product !== 'points_2000') {
      return json({ error: 'product invalide (flame_freeze | points_2000)' }, 400);
    }

    const priceId = Deno.env.get(PRODUCT_PRICE_ENV[product]);
    if (!priceId) return json({ error: `Prix Stripe non configuré (${PRODUCT_PRICE_ENV[product]})` }, 500);

    // Identité de l'appelant (RLS appliqué via son JWT)
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: 'Session invalide ou expirée' }, 401);

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    const redirectBase = Deno.env.get('APP_REDIRECT_URL') ?? 'ootd://shop';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email ?? undefined,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      // Métadonnées lues par le webhook pour créditer le bon utilisateur
      payment_intent_data: {
        metadata: { supabase_user_id: user.id, product },
      },
      metadata: { supabase_user_id: user.id, product },
      success_url: `${redirectBase}?status=success`,
      cancel_url: `${redirectBase}?status=cancelled`,
    });

    return json({ url: session.url }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur interne' }, 500);
  }
});
