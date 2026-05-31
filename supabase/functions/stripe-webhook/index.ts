// OOTD — Edge Function : stripe-webhook
// Écoute les événements d'abonnement Stripe et met à jour la table `subscriptions`
// via la RPC sécurisée `apply_subscription_change` (service_role).
//
// ─── Configuration ───────────────────────────────────────────────────────────
//   STRIPE_SECRET_KEY    : clé secrète Stripe
//   STRIPE_WEBHOOK_SECRET : secret de signature du endpoint webhook (whsec_…)
//                           => Dashboard Stripe → Developers → Webhooks → ton endpoint
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY : injectés automatiquement
//
// ⚠️ Déployer SANS vérification JWT (Stripe ne fournit pas de JWT Supabase) :
//   `supabase functions deploy stripe-webhook --no-verify-jwt`
//
// Événements écoutés : customer.subscription.created / updated / deleted

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

// Mappe un price_id Stripe → type de plan. Renseigne tes IDs ici (mêmes que
// STRIPE_PRICE_PLUS / STRIPE_PRICE_ELITE) pour dériver le plan depuis l'abonnement.
function planFromMetadataOrPrice(sub: Stripe.Subscription): string | null {
  const metaPlan = sub.metadata?.plan_type;
  if (metaPlan === 'plus' || metaPlan === 'elite') return metaPlan;

  const priceId = sub.items?.data?.[0]?.price?.id;
  if (priceId && priceId === Deno.env.get('STRIPE_PRICE_ELITE')) return 'elite';
  if (priceId && priceId === Deno.env.get('STRIPE_PRICE_PLUS')) return 'plus';
  return null;
}

serve(async (req: Request) => {
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeKey || !webhookSecret) {
    return new Response('Stripe non configuré (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET)', { status: 500 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Signature manquante', { status: 400 });

  const stripe = new Stripe(stripeKey, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });

  // Vérifie la signature du webhook (constructEventAsync requis en Deno/edge)
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (err) {
    return new Response(`Signature invalide: ${err instanceof Error ? err.message : 'erreur'}`, { status: 400 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    switch (event.type) {
      // Achat express one-time (Gel de Flamme, Pack de points) : fulfillment
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        // Les checkouts d'abonnement sont gérés par customer.subscription.* : on ignore ici
        if (session.mode !== 'payment') break;
        if (session.payment_status !== 'paid') break;

        const userId  = session.metadata?.supabase_user_id ?? session.client_reference_id ?? null;
        const product = session.metadata?.product ?? null;
        if (!userId || !product) {
          return new Response(JSON.stringify({ received: true, skipped: 'no_meta' }), { status: 200 });
        }

        // RPC idempotente (créditera une seule fois cette session)
        const { error } = await admin.rpc('apply_one_time_purchase', {
          p_session_id: session.id,
          p_user_id:    userId,
          p_product:    product,
        });
        if (error) {
          return new Response(`DB error: ${error.message}`, { status: 500 });
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;

        // Retrouve l'utilisateur : métadonnées de l'abonnement, sinon du customer
        let userId = sub.metadata?.supabase_user_id ?? null;
        if (!userId) {
          const customer = await stripe.customers.retrieve(sub.customer as string);
          if (customer && !('deleted' in customer && customer.deleted)) {
            userId = (customer as Stripe.Customer).metadata?.supabase_user_id ?? null;
          }
        }
        if (!userId) {
          // Pas de mapping : on ignore proprement (rien à mettre à jour)
          return new Response(JSON.stringify({ received: true, skipped: 'no_user' }), { status: 200 });
        }

        // 'deleted' => résiliation effective
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : sub.status;
        const planType = planFromMetadataOrPrice(sub);
        const periodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;

        const { error } = await admin.rpc('apply_subscription_change', {
          p_user_id:         userId,
          p_customer_id:     sub.customer as string,
          p_subscription_id: sub.id,
          p_status:          status,
          p_plan_type:       planType,
          p_period_end:      periodEnd,
          p_cancel_at_end:   !!sub.cancel_at_period_end,
        });
        if (error) {
          return new Response(`DB error: ${error.message}`, { status: 500 });
        }
        break;
      }
      default:
        // Événement non géré : accusé de réception pour éviter les ré-essais Stripe
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(`Erreur traitement: ${err instanceof Error ? err.message : 'inconnue'}`, { status: 500 });
  }
});
