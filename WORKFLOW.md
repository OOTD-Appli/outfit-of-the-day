# WORKFLOW.md — Développement et déploiement OOTD

> Dernière mise à jour : 2026-06-11

## Prérequis

- Node.js 20+
- npm (livré avec Node)
- Compte Expo / EAS CLI : `npm install -g eas-cli`
- Compte Supabase avec un projet actif
- Supabase CLI : `npm install -g supabase` (requis pour déployer les Edge Functions)
- Compte Google AI Studio (Gemini) : https://aistudio.google.com — clé stockée comme secret Supabase
- Compte Groq (fallback IA) : https://console.groq.com — clé stockée comme secret Supabase
- Compte Stripe (paiements) : https://stripe.com — mode TEST pour le dev
- Vercel CLI (web/PWA) : `npm install -g vercel`

---

## Setup initial (nouveau poste)

```bash
# 1. Cloner le repo
git clone <url-repo> && cd ootd

# 2. Installer les dépendances
npm install

# 3. Créer le fichier d'env (ne jamais committer .env)
cp .env.example .env
# → éditer .env avec EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY
# → EXPO_PUBLIC_GROQ_API_KEY : uniquement pour usage local direct
#    (en production : la clé est un secret Supabase côté Edge Function)

# 4. Appliquer les migrations Supabase (voir section ci-dessous)

# 5. Déployer les Edge Functions (voir section ci-dessous)
```

---

## Lancer l'app en dev

```bash
npm start          # Expo dev server (QR code → Expo Go)
npm run android    # Lancer sur émulateur/device Android
npm run ios        # Lancer sur simulateur iOS (Mac uniquement)
npm run web        # Lancer dans le navigateur (PWA dev)
```

> **Expo Go vs build natif** : les notifications push et certaines fonctionnalités natives ne fonctionnent pas dans Expo Go. Pour tester les notifs, utiliser un build preview EAS.

---

## Migrations Supabase

Les fichiers SQL sont dans `supabase/migrations/`. Appliquer **dans l'ordre** sur un projet vide.

| # | Fichier | Contenu |
|---|---------|---------|
| 1 | `20260510120000_initial_schema.sql` | Tables core + RLS + buckets `avatars`/`ootds` |
| 2 | `20260510121500_existing_project_align.sql` | Alignement projet existant (idempotent) |
| 3 | `20260511130000_comments.sql` | Table `comments` + RLS + indexes |
| 4 | `20260522140000_messages_stories.sql` | Tables `messages` + `stories` + bucket `stories` |
| 5 | `20260522150000_add_caption_to_ootds.sql` | Colonne `caption` sur `ootds` |
| 6 | `20260523160000_stories_video.sql` | Colonnes `video_url`, `overlay_text`, `caption` sur `stories` |
| 7 | `20260525170000_daily_credits.sql` | Crédits quotidiens + RPC `consume_daily_credit` |
| 8 | `20260525180000_shop_columns.sql` | Colonnes shop dans `profiles` (passes, cosmétiques) |
| 9 | `20260528100000_security_hardening.sql` | Trigger guard + RPCs SECURITY DEFINER + RLS renforcées |
| 10 | `20260529120000_stories_gc.sql` | ⚠️ Trigger cleanup Storage + job pg_cron horaire (À exécuter dans SQL Editor) |
| 11 | `20260531120000_subscriptions_stripe.sql` | Table `subscriptions` + helpers Stripe |
| 12 | `20260531130000_shop_revamp.sql` | RPCs `buy_cosmetic`, `equip_cosmetic` v2 |
| 13 | `20260531140000_shop_express.sql` | Achats one-time + `apply_one_time_purchase` RPC |
| 14 | `20260531150000_flamme_restore.sql` | RPC `restore_flamme` + colonne `flame_freezes` |
| 15 | `20260601120000_web_push.sql` | Table `web_push_subscriptions` + policies Storage |
| 16 | `20260602120000_messages_interactions.sql` | Colonnes `is_liked`, `is_deleted`, `read_at` + RPCs like/delete/read |
| 17 | `20260602140000_profile_privacy.sql` | Colonne `is_private` sur `profiles` |
| 18 | `20260602160000_fix_delete_message_constraint.sql` | Fix FK constraint suppression messages |
| 19 | `20260602180000_profile_bio.sql` | Colonne `bio` sur `profiles` |
| 20 | `20260603100000_performance_indexes.sql` | Index de performance (created_at DESC, receiver_id, etc.) |
| 21 | `20260603120000_ootds_audio.sql` | Colonnes audio Deezer sur `ootds` |
| 22 | `20260603140000_default_star_logo.sql` | `active_logo` DEFAULT 'star' |
| 23 | `20260604120000_read_receipts.sql` | Colonne `read_at` + RPC `mark_messages_read` |
| 24 | `20260607120000_ootds_is_public.sql` | Colonne `is_public` + RLS feed privé |
| 25 | `20260611130000_performance_indexes.sql` | Index supplémentaires (expires_at, is_public) |
| 26 | `20260611140000_profiles_private.sql` | Table `profiles_private` (push_token, RLS stricte) |
| 27 | `20260611150000_image_url_constraints.sql` | CHECK NOT VALID sur `ootds.image_url` + `messages.image_url` |
| 28 | `20260611160000_analyze_rate_limit.sql` | Table `analyze_rate_limit` + RPC `check_analyze_rate_limit` |
| 29 | `20260612100000_messages_reply_to.sql` | Colonne `reply_to_id` sur `messages` (swipe-to-reply) + index |

**Sur un projet vide** : exécuter `initial_schema.sql` puis les migrations 3 à 28 dans l'ordre.  
**Sur un projet existant** : utiliser `existing_project_align.sql` (IF NOT EXISTS) puis les migrations 3 à 28.  
**Ne jamais re-exécuter** `initial_schema.sql` si les tables existent déjà.

```bash
# Via CLI (après `supabase link`)
supabase db push

# Via SQL Editor : copier-coller chaque fichier dans l'ordre
```

> ⚠️ La migration `20260529120000_stories_gc.sql` utilise pg_cron — à exécuter dans le SQL Editor Supabase (pas via CLI).

---

## Edge Functions Supabase

### Lier le projet + définir les secrets

```powershell
# Créer un token sur https://supabase.com/dashboard/account/tokens
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."

# Lier au projet Supabase
supabase link --project-ref <project-ref>

# Définir tous les secrets d'un coup
supabase secrets set `
  GEMINI_API_KEY=AIza... `
  GROQ_API_KEY=gsk_... `
  STRIPE_SECRET_KEY=sk_test_... `
  STRIPE_WEBHOOK_SECRET=whsec_... `
  STRIPE_PRICE_PLUS=price_... `
  STRIPE_PRICE_ELITE=price_... `
  STRIPE_PRICE_FLAME_FREEZE=price_... `
  STRIPE_PRICE_POINTS_2000=price_... `
  APP_REDIRECT_URL=ootd://shop `
  APP_ORIGIN=https://ootd-fr-ootd.vercel.app `
  VAPID_PUBLIC_KEY=BKq... `
  VAPID_PRIVATE_KEY=abc... `
  VAPID_SUBJECT=mailto:contact@ootd.app
```

> `APP_ORIGIN` restreint le CORS des Edge Functions. Par défaut `*` si absent.

### Déployer toutes les Edge Functions

```bash
# Fonction principale (IA + rate-limit)
supabase functions deploy analyze-outfit

# Proxy Deezer (pas de JWT requis)
supabase functions deploy deezer-search --no-verify-jwt

# Stripe — Checkout et portail
supabase functions deploy create-checkout-session
supabase functions deploy create-payment-session
supabase functions deploy create-portal-session

# Stripe Webhook (Stripe ne fournit pas de JWT Supabase)
supabase functions deploy stripe-webhook --no-verify-jwt

# Web Push
supabase functions deploy send-web-push
```

### Mises à jour

```bash
# Après modification d'une fonction, re-déployer uniquement celle-ci
supabase functions deploy <nom-fonction>
```

### Vérifier les secrets

```bash
supabase secrets list
```

---

## Déploiement Web / PWA (Vercel)

```bash
# Preview
vercel

# Production
vercel --prod
```

Le build est défini par `"vercel-build": "expo export --platform web && node scripts/inject-pwa.js"`.

**Variables d'environnement Vercel** (définir dans Dashboard Vercel → Settings → Environment Variables) :
```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_GROQ_API_KEY   # optionnel, uniquement si analyse côté client sur web
```

> La clé Gemini/Groq pour les Edge Functions est dans les secrets Supabase, **pas dans Vercel**.

---

## Build et déploiement mobile (EAS)

```bash
# APK Android (test / distribution interne)
npm run eas:build:preview

# AAB Android (Play Store)
npm run eas:build:prod
```

**Variables EAS** (expo.dev → Project Settings → Environment Variables) :
```
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

> Versioning géré par EAS remote : `eas.json → cli.appVersionSource: "remote"`.

---

## Flow de développement — cycle habituel

```
1. Lire TACHES.md et CLAUDE.md
2. Créer une branche : git checkout -b feat/nom-feature
3. Implémenter le changement
4. Vérifier la checklist ci-dessous
5. Mettre à jour TACHES.md (marquer terminé / ajouter nouveaux items)
6. Commit : git add <fichiers> && git commit -m "description"
7. git push
8. vercel --prod (si changement web)
9. supabase functions deploy <fn> (si changement Edge Function)
```

---

## Checklist avant commit

**Hooks React**
- [ ] `const { showToast } = useToast()` au niveau top du composant (jamais dans un callback)
- [ ] `const { theme } = useTheme()` si le composant affiche des couleurs
- [ ] `ToastProvider` + `ThemeProvider` enveloppent bien le retour de `App()` pour les deux branches

**Imports React Native**
- [ ] `Alert`, `TouchableOpacity`, `Image`, `ActivityIndicator` importés si utilisés dans le JSX

**Utilitaires partagés**
- [ ] `computeNiveau`, `computeLevelInfo`, `timeAgo` → importer depuis `lib/utils` (pas de copie locale)
- [ ] `getLogoConfig` → importer depuis `lib/logoConfig`
- [ ] Si la logique de niveau change → mettre à jour **aussi** `compute_niveau()` en Postgres (migration SQL)

**Invariants métier**
- [ ] Paires flammes : `flammeOrderedIds()` avant tout insert/query (user1 < user2)
- [ ] Snap quotidien : `hasSnapUsedTodayForPair()` vérifié avant insert dans `snaps`
- [ ] Streak flammes : jours calendaires ISO (pas fenêtre 24h glissante)
- [ ] Upload fichier : `fetch(uri).blob()` — compatible Android, iOS et web

**Sécurité**
- [ ] Jamais de clé API dans le code client ou `.env` versionné
- [ ] Toute nouvelle Edge Function vérifie le header `Authorization` (sauf `--no-verify-jwt` intentionnel)
- [ ] Toute nouvelle Edge Function hérite du pattern CORS : `Deno.env.get('APP_ORIGIN') ?? '*'`
- [ ] Nouveaux champs DB → migration SQL dans `supabase/migrations/` (nom : `YYYYMMDDHHMMSS_description.sql`)
- [ ] Ne jamais écrire directement sur les colonnes sensibles de `profiles` — RPCs SECURITY DEFINER uniquement
- [ ] `savePushToken` → `profiles_private`, jamais `profiles`
- [ ] Ne jamais supprimer les stories côté client (pg_cron gère la purge + trigger Storage)
- [ ] Toute mutation économique (points, passes, crédits, gels, cosmétiques) → RPC, jamais UPDATE direct

**UI**
- [ ] Textes UI en français
- [ ] Couleurs via `theme.xxx` — pas de couleurs hardcodées dans les composants thématisés
- [ ] Pas de `alert()` natif — utiliser `showToast()` ou `Alert.alert()`
- [ ] Pas de bouton qui accorde des points sans validation réelle

---

## Architecture des données en bref (pour les agents)

```
profiles          — 1 ligne par user. Contient points, niveau, crédits, passes, cosmétiques,
                   flame_freezes, is_private, bio.
                   ⚠️ Ne jamais UPDATE les colonnes sensibles directement → RPCs.
profiles_private  — push_token uniquement. RLS owner-only + service_role.
ootds             — Posts (tenues). image_url, scores IA, caption, audio, is_public.
likes             — UNIQUE(user_id, ootd_id). Append-only.
comments          — body 1–1000 chars. user_id → profiles.id.
friendships       — PK(user_id, friend_id). Direction : user_id=demandeur. Agrégé bidir côté app.
flammes           — user1_id < user2_id (invariant). Streak par jours calendaires.
messages          — Éphémères 24h. is_liked, is_deleted (soft), read_at. image_url CHECK NOT VALID.
snaps             — Legacy (envoi tenue à amis). 1/jour/paire.
stories           — Éphémères 24h. video_url ou image_url. overlay_text + caption.
subscriptions     — Stripe (Plus/Elite). RLS read-only. Mutations via service_role uniquement.
web_push_subscriptions — endpoint/p256dh/auth Web Push. RLS owner-only.
analyze_rate_limit — rate-limit 5 req/min par user. Sans RLS (SECURITY DEFINER uniquement).
```

**Storage** : `avatars` (`<uid>/avatar.jpg`), `ootds` (`<uid>/outfit_<ts>.{jpg,webp}` + `messages/<uid>/<ts>.jpg`), `stories` (`<uid>/<ts>.mp4`).

---

## Collaboration multi-agents IA

Chaque agent qui prend un ticket doit :

1. **Lire CLAUDE.md en entier** — surtout la section bugs critiques
2. **Vérifier git status** — les fichiers modifiés non commités peuvent être cassés
3. **Ne pas modifier le schéma SQL sans ajouter une migration** dans `supabase/migrations/` — nommer `YYYYMMDDHHMMSS_description.sql`
4. **Ne pas introduire de state global** (pas Redux, pas Zustand) — state local dans les écrans
5. **Ne pas changer la langue de l'UI** — tout en français
6. **Mettre à jour TACHES.md** à la fin de chaque intervention
7. **Ne pas committer `.env`** — il est gitignored
8. **Upload de fichiers** : `fetch(uri).blob()` (fonctionne Android + iOS + web, y compris URI `content://`)
9. **Utilitaires** : toujours importer depuis `lib/utils` / `lib/logoConfig` / etc. — jamais copier localement
10. **Mutations économiques** : RPCs SECURITY DEFINER uniquement
11. **Push token** : `savePushToken()` → `profiles_private`, jamais `profiles`
12. **CORS** : toute nouvelle Edge Function doit utiliser `Deno.env.get('APP_ORIGIN') ?? '*'`
13. **Rate-limit** : le check `check_analyze_rate_limit` doit rester **avant** `consume_daily_credit` dans `analyze-outfit`

### Répartition logique des domaines (pour parallélisation)

| Domaine | Fichiers concernés |
|---------|-------------------|
| Auth & profil | `AuthScreen.js`, `ResetPasswordScreen.js`, `ProfilScreen.js`, `lib/ensureProfile.js`, `lib/notifications.js`, `lib/pwa.js` |
| Feed & social | `FeedScreen.js`, `components/FeedCommentsModal.js` |
| Analyse IA | `AccueilScreen.js` (bloc analyse), `CustomizationScreen.js`, `supabase/functions/analyze-outfit/`, `supabase/functions/deezer-search/` |
| Flammes & messages | `FlammesScreen.js`, `AccueilScreen.js` (bloc sendOutfitToAllFlammes), `lib/flammesUtils.js`, `lib/activeChat.js` |
| Shop & cosmétiques | `ShopScreen.js`, `lib/themeContext.js`, `lib/logoConfig.js`, `supabase/functions/create-*`, `supabase/functions/stripe-webhook/` |
| Notifications | `lib/notifications.js`, `lib/pwa.js`, `lib/webPush.js`, `supabase/functions/send-web-push/` |
| Utilitaires partagés | `lib/utils.js`, `lib/toastContext.js`, `lib/haptics.js` |
| Infrastructure | `App.js`, `lib/supabase.js`, `lib/env.js`, `supabase/migrations/` |
| Composants UI | `components/Button.js`, `components/Avatar.js`, `components/FeedCommentsModal.js` |

> Les domaines "Feed" et "Flammes" partagent `lib/supabase.js` et `lib/toastContext.js` — ne pas les modifier en parallèle sans coordination.
