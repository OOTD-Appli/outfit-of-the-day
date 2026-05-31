# Configuration des abonnements Premium (Stripe)

Économie séparée en deux :
- **Points (gratuit)** : cosmétiques (thèmes/logos) + pass legacy — inchangé, RPC `buy_pass` / `buy_cosmetic` / `equip_cosmetic`.
- **Premium (Stripe)** : abonnements mensuels `plus` (4,99€) et `elite` (9,99€) — 100 % sécurisé côté serveur (Edge Functions + Webhook).

---

## 1. Migration base de données

Exécuter la migration dans Supabase (SQL Editor ou `supabase db push`) :

```
supabase/migrations/20260531120000_subscriptions_stripe.sql
```

Elle crée la table `subscriptions` (RLS lecture seule), le helper `is_elite()`, la RPC
webhook-only `apply_subscription_change()` (EXECUTE réservé à `service_role`), et met à jour
`consume_daily_credit()` (tiers Elite illimité / Plus 20 / Free 2) et `equip_cosmetic()`
(Elite débloque tous les cosmétiques).

## 2. Côté Stripe (Dashboard)

1. Crée 2 **produits** avec un **prix récurrent mensuel** chacun :
   - OOTD Plus → 4,99€/mois → note le `price_…` → `STRIPE_PRICE_PLUS`
   - OOTD Elite → 9,99€/mois → note le `price_…` → `STRIPE_PRICE_ELITE`
2. Active le **Customer Portal** : Settings → Billing → Customer portal → Activer.
3. Crée un **endpoint Webhook** pointant vers la fonction `stripe-webhook` :
   - URL : `https://<PROJECT_REF>.supabase.co/functions/v1/stripe-webhook`
   - Événements : `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`
   - Récupère le **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`

## 3. Secrets Supabase (Dashboard → Edge Functions → Manage secrets)

```
STRIPE_SECRET_KEY      = sk_live_… (ou sk_test_…)
STRIPE_PRICE_PLUS      = price_…   (plan Plus)
STRIPE_PRICE_ELITE     = price_…   (plan Elite)
STRIPE_WEBHOOK_SECRET  = whsec_…
APP_REDIRECT_URL       = ootd://shop   (optionnel — retour vers l'app après paiement)
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sont injectés automatiquement.)

## 4. Déploiement des Edge Functions

```bash
supabase functions deploy create-checkout-session
supabase functions deploy create-portal-session
supabase functions deploy stripe-webhook --no-verify-jwt
```
⚠️ `stripe-webhook` doit être déployé avec `--no-verify-jwt` (Stripe ne fournit pas de JWT
Supabase ; l'authenticité est garantie par la signature `STRIPE_WEBHOOK_SECRET`).

## 5. Deep link

`app.json` a reçu `"scheme": "ootd"` pour le retour `ootd://shop` après paiement/portail.

---

## Flux

1. `ShopScreen` → "S'abonner" → invoke `create-checkout-session` → ouvre l'URL Stripe (navigateur).
2. Paiement → Stripe envoie `customer.subscription.*` au webhook.
3. `stripe-webhook` → RPC `apply_subscription_change` → met à jour `subscriptions`.
4. Au retour dans l'app (focus onglet), `ShopScreen`/`AccueilScreen`/`ProfilScreen` relisent
   `subscriptions` : crédits (illimité/20/2), cosmétiques Elite, badge profil.
5. "Gérer mon abonnement" → invoke `create-portal-session` → Customer Portal Stripe.

## Sécurité

- Le statut Premium n'est jamais écrit par le client : seul le webhook (`service_role`) écrit
  dans `subscriptions` via la RPC à EXECUTE révoqué.
- Le plafond d'analyses est appliqué **côté serveur** dans `consume_daily_credit` (appelée par
  l'Edge Function `analyze-outfit`) — le front ne fait que l'affichage.
- L'accès cosmétique Elite est **dérivé** de l'abonnement (`is_elite`), donc révoqué
  automatiquement à la résiliation.
