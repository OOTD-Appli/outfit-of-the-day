# WORKFLOW.md — Développement et déploiement OOTD

> Dernière mise à jour : 2026-09-27 (écran Compétition réécrit selon la maquette v4 "gestes séparés")

## Prérequis

- Node.js 20+
- npm (livré avec Node)
- Compte Expo / EAS CLI : `npm install -g eas-cli`
- Instance Supabase **self-hosted** (`supabase.myback.fr`, docker-compose officiel) — voir `docs/MIGRATION_SUPABASE_SELFHOST.md`
- Supabase CLI : `npm install -g supabase` (pilote les migrations via `--db-url`, pas de `supabase link` classique sur ce self-host)
- Compte Google AI Studio (Gemini) : https://aistudio.google.com — clé stockée comme secret côté serveur
- Compte Groq (fallback IA) : https://console.groq.com — clé stockée comme secret côté serveur
- Compte Stripe (paiements) : **mode Live** depuis 2026-08-19
- Vercel CLI (web/PWA) : `npm install -g vercel` — projet `outfit-of-the-day` (⚠️ pas `ootd-fr`)
- Accès SSH au serveur self-host pour tout ce qui touche aux Edge Functions ou à Docker — l'agent IA n'y a **jamais** accès direct, voir section dédiée plus bas

---

## Setup initial (nouveau poste)

```bash
# 1. Cloner le repo
git clone https://github.com/OOTD-Appli/outfit-of-the-day.git && cd outfit-of-the-day

# 2. Installer les dépendances
npm install

# 3. Créer le fichier d'env (ne jamais committer .env)
cp .env.example .env
# → éditer .env avec EXPO_PUBLIC_SUPABASE_URL (https://supabase.myback.fr) et EXPO_PUBLIC_SUPABASE_ANON_KEY

# 4. Appliquer les migrations Supabase (voir section ci-dessous)

# 5. Vérifier que les Edge Functions du serveur sont à jour (voir section dédiée)
```

---

## Lancer l'app en dev

```bash
npm start          # Expo dev server (QR code → Expo Go)
npm run android    # Lancer sur émulateur/device Android
npm run ios        # Lancer sur simulateur iOS (Mac uniquement)
npm run web        # Lancer dans le navigateur (PWA dev)
npm test           # Jest — filet de sécurité (smoke test + tests unitaires lib/)
```

> **Expo Go vs build natif** : les notifications push et certaines fonctionnalités natives ne fonctionnent pas dans Expo Go. Pour tester les notifs, utiliser un build preview EAS.

---

## Migrations Supabase

Les fichiers SQL sont dans `supabase/migrations/`, appliqués **dans l'ordre** sur l'instance self-host :

```bash
# PowerShell/bash — depuis App/ootd
$env:PGSSLMODE = "disable"          # ou export PGSSLMODE=disable en bash
npx supabase db push --db-url "postgres://postgres.your-tenant-id:<pwd>@192.168.1.99:5432/postgres" --yes
```

> Le port 5432 exposé route vers **Supavisor** (pooler), pas le Postgres brut — utilisateur `postgres.your-tenant-id`, TLS refusé (`PGSSLMODE=disable` obligatoire). Voir `docs/MIGRATION_SUPABASE_SELFHOST.md` pour le détail de l'infrastructure.

**Migrations les plus anciennes** (1-38, jusqu'à `20260812120000_persona_tier_gating.sql`) : schéma initial, Stories (depuis supprimées), système de crédits/tiers, cosmétiques, Stripe, messages/flammes 1-à-1, personnalités IA. Voir l'historique git pour le détail si besoin — non listées ici car largement supersédées par la refonte Compétitions.

**Migrations "Compétitions v2"** (2026-09) — celles qui comptent pour toute évolution actuelle :

| Fichier | Contenu |
|---------|---------|
| `20260814120000_stories_media_transform.sql` | Dernière migration de l'ère pré-Compétitions (transform média Stories) |
| `20260917120000_fix_buy_cosmetic_pricing.sql` | Corrige la grille de prix `buy_cosmetic` (écrasée par erreur par une migration antérieure) |
| `20260917130000_competitions_core.sql` | Tables `competitions`, `competition_members`, `ootd_competitions` + RLS + RPC `create_competition` |
| `20260917140000_competition_invites.sql` | Table `competition_invites` + RPCs `create_competition_invite`/`get_competition_invite_preview`/`redeem_competition_invite`/`revoke_competition_invite` |
| `20260918120000_competition_messages.sql` | Table `competition_messages` (chat de groupe) + RLS + RPCs `delete_competition_message`/`mark_competition_read` + Realtime |
| `20260919120000_competition_leaderboards.sql` | RPCs `get_top3_app`/`get_top3_friends` (classement hebdomadaire) |
| `20260920100000_submit_ootd_to_competitions.sql` | RPC atomique de publication `submit_ootd_to_competitions` |
| `20260921120000_ai_prompt_v3_scores.sql` | `ootds.score_scale` + `award_points_for_ootd` recalibré pour la note sur 100 |
| `20260922120000_stories_purge.sql` | Purge complète Stories (table, cron, trigger) — **le bucket/les fichiers Storage ont dû être supprimés séparément via l'API Storage, pas en SQL**, voir Post-mortems dans ARCHITECTURE.md |
| `20260923120000_create_competition_with_members.sql` | RPC `create_competition_with_members` (création + sélection des membres en une fois) |
| `20260924120000_fix_competition_rls_and_fk.sql` | Corrige la récursion RLS infinie (`is_competition_member` helper) + FK `competition_messages.sender_id` → `profiles(id)` |
| `20260925120000_competition_streak.sql` | `competition_members.streak_count`/`last_submission_date` + logique de streak dans `submit_ootd_to_competitions` + RPC `restore_competition_streak` (décision D4) |
| `20260925130000_competition_leaderboard_and_palmares.sql` | RPC `get_competition_leaderboard` (classement par compétition + blocs Régularité/Progression/Coup de cœur) + `get_top3_app`/`get_top3_friends` paramétrées par période (décisions D1/D3/D5) — dépend de la migration précédente (colonnes de streak) |
| `20260927120000_competition_chat_social.sql` | `competition_messages.reply_to_id`/`quoted_label` (réponses) + tables `competition_message_likes`/`competition_message_reactions` + RPCs `toggle_competition_message_like`/`add_competition_message_reaction` (écran Compétition v4 "gestes séparés") |

**Nouveau projet self-host vierge** : rejouer toutes les migrations dans l'ordre depuis `20260510120000_initial_schema.sql`. **Sur l'instance de prod existante** : n'appliquer que les migrations pas encore poussées — `supabase db push` détecte automatiquement lesquelles via sa table de suivi interne, il suffit de lancer la commande, elle est idempotente.

> ⚠️ Si `supabase db push` échoue à mi-fichier (ex. `DELETE FROM storage.objects` refusé), **toute la migration est annulée** (transaction unique) — vérifier l'état réel avant de corriger et rejouer, ne pas supposer un état partiel.

---

## Edge Functions Supabase (self-host)

Ce self-host **n'utilise pas** `supabase functions deploy` classique — le code des fonctions est bind-monté sur le serveur et doit être **retéléchargé manuellement depuis GitHub** après chaque modification.

### Après avoir modifié une Edge Function

```bash
# Sur le serveur (SSH), dans le dossier du docker-compose self-host
cd /chemin/vers/le/dossier-supabase-selfhost

curl -o volumes/functions/<nom-fonction>/index.ts \
  https://raw.githubusercontent.com/OOTD-Appli/outfit-of-the-day/main/supabase/functions/<nom-fonction>/index.ts

docker compose up -d functions
docker compose logs -f functions   # vérifier le démarrage sans erreur, Ctrl+C pour sortir
```

**Fonctions actives** : `analyze-outfit`, `deezer-search`, `create-checkout-session`, `create-payment-session`, `create-portal-session`, `stripe-webhook`, `send-web-push`.

> `contextual-analysis` a été **supprimée** (2026-09-24) — ne plus la redéployer, son dossier peut être laissé tel quel sur le serveur s'il traîne encore (l'app ne l'appelle plus).

> **Piège à connaître** : un `git push` sur ce repo ne redéploie **jamais** automatiquement une Edge Function côté self-host. Après toute modification de `supabase/functions/*/index.ts`, vérifier explicitement avec la personne qui a accès SSH au serveur que la synchro ci-dessus a bien été faite — sinon l'ancien code continue de tourner silencieusement (piège déjà rencontré : un recalibrage du prompt de notation IA poussé sur GitHub sans resynchronisation aurait pu passer inaperçu).

### Secrets (définis directement dans le `.env` du docker-compose serveur, pas via `supabase secrets set`)

```
GEMINI_API_KEY, GROQ_API_KEY
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_PLUS, STRIPE_PRICE_ELITE, STRIPE_PRICE_FLAME_FREEZE, STRIPE_PRICE_POINTS_2000
APP_REDIRECT_URL=ootd://shop
APP_ORIGIN=https://ootd-fr.vercel.app
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
```

> Ne jamais demander à un humain de coller une valeur de secret réelle dans une conversation ou un fichier versionné.

---

## Déploiement Web / PWA (Vercel)

```bash
# Preview
vercel

# Production — TOUJOURS vérifier le lien avant, projet "outfit-of-the-day"
vercel link --yes --project outfit-of-the-day
vercel --prod
```

Le build est défini par `"vercel-build": "expo export --platform web && node scripts/inject-pwa.js"`. L'alias de production `ootd-fr.vercel.app` est mis à jour automatiquement par `vercel --prod`.

> ⚠️ **Piège nommage** : `ootd-fr.vercel.app` est le domaine du projet **`outfit-of-the-day`**, pas d'un projet qui s'appellerait `ootd-fr` (qui existe aussi sur le compte Vercel mais est un projet différent, obsolète). Toujours vérifier `.vercel/project.json` ou relier explicitement avant un déploiement si le contexte n'est pas sûr.

**Variables d'environnement Vercel** (Dashboard → Settings → Environment Variables) :
```
EXPO_PUBLIC_SUPABASE_URL=https://supabase.myback.fr
EXPO_PUBLIC_SUPABASE_ANON_KEY
EXPO_PUBLIC_VAPID_PUBLIC_KEY
```

---

## Build et déploiement mobile (EAS)

```bash
npm run eas:build:preview   # APK Android (test / distribution interne)
npm run eas:build:prod      # AAB Android (Play Store)
```

**Variables EAS** (expo.dev → Project Settings → Environment Variables) : `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Versioning géré par EAS remote (`eas.json → cli.appVersionSource: "remote"`).

---

## Flow de développement — cycle habituel

```
1. Lire TACHES.md et CLAUDE.md
2. Implémenter le changement (commits séparés par sous-étape logique, pas un seul gros commit — voir historique récent pour l'exemple)
3. npm test — vérifier que le smoke test + les tests unitaires passent
4. Mettre à jour TACHES.md / ARCHITECTURE.md / WORKFLOW.md si le changement affecte l'architecture
5. git add <fichiers précis> && git commit -m "description" (jamais `git add -A` dans ce dossier — voir Sécurité)
6. git push
7. Si migration SQL : l'appliquer sur le self-host (`supabase db push --db-url ...`)
8. Si Edge Function modifiée : demander/vérifier la resynchro manuelle côté serveur (voir section dédiée)
9. vercel --prod (si changement frontend/web)
```

---

## Checklist avant commit

**Hooks React**
- [ ] `const { showToast } = useToast()` au niveau top du composant (jamais dans un callback)
- [ ] `const { theme } = useTheme()` si le composant affiche des couleurs

**Utilitaires partagés**
- [ ] `computeNiveau`, `computeLevelInfo`, `timeAgo` → importer depuis `lib/utils` (pas de copie locale)
- [ ] Si la logique de niveau change → mettre à jour **aussi** `compute_niveau()` en Postgres

**Invariants métier**
- [ ] Upload fichier : `fetch(uri).blob()` — compatible Android, iOS et web
- [ ] Tags de style IA : toujours filtrés contre la whitelist serveur (20 styles)
- [ ] Préférence dark/light : via `useTheme().colorMode`/`setColorMode()` — jamais une colonne `profiles` (c'est `user_metadata.dark_mode`)
- [ ] Toute colonne destinée à être embed-jointe avec `profiles` dans un `.select()` client → FK vers `profiles(id)`, **jamais** `auth.users(id)` (PostgREST ne peut pas résoudre l'embed sinon — piège déjà rencontré 2 fois, voir Post-mortems ARCHITECTURE.md)
- [ ] Tri par une colonne d'une ressource imbriquée → `.order('col', { foreignTable: 'table', ascending })`, **jamais** `.order('table(col)', ...)` (syntaxe invalide, échoue silencieusement ou en erreur visible)
- [ ] Nouvelle policy RLS qui vérifie une appartenance/relation sur **la même table** qu'elle protège → passer par une fonction `SECURITY DEFINER`, jamais un `EXISTS` direct sur la même table (récursion infinie)

**Sécurité**
- [ ] Jamais de clé API dans le code client ou `.env` versionné
- [ ] Toute nouvelle Edge Function vérifie le header `Authorization` (sauf `--no-verify-jwt` intentionnel) et hérite du pattern CORS `Deno.env.get('APP_ORIGIN') ?? '*'`
- [ ] Nouveaux champs DB → migration SQL dans `supabase/migrations/` (nom : `YYYYMMDDHHMMSS_description.sql`)
- [ ] Ne jamais écrire directement sur les colonnes sensibles de `profiles` — RPCs SECURITY DEFINER uniquement
- [ ] Toute mutation économique (points, passes, crédits, gels, cosmétiques) → RPC, jamais UPDATE direct
- [ ] Nouvelle table où les membres doivent pouvoir "rejoindre" → **pas** de policy INSERT directe pour `authenticated` (une simple `WITH CHECK (user_id = auth.uid())` laisserait n'importe qui s'auto-ajouter) — passer par une RPC qui valide l'invitation/l'amitié avant d'insérer
- [ ] **Ne jamais faire `git add -A` ni `git add .` dans `App/ootd`** : `.claude/`, `.agents/`, `.mcp.json`, `skills-lock.json`, `supabase/.temp/` contiennent des jetons/config qui ne doivent jamais être committés — toujours lister les fichiers explicitement
- [ ] Toute action qui écrit sur l'infrastructure de production (migration DB, secret, webhook Stripe live) est confirmée explicitement avant exécution — jamais supposée depuis une instruction générique

**UI**
- [ ] Textes UI en français
- [ ] Couleurs via `theme.xxx` — pas de couleurs hardcodées dans les composants thématisés
- [ ] Pas de `alert()` natif — utiliser `showToast()` ou `Alert.alert()`

---

## Architecture des données en bref (pour les agents)

```
profiles              — 1 ligne par user. points, niveau, crédits, passes, cosmétiques,
                       is_private, bio, style_stats (jsonb), specialized_feed, analysis_personality.
                       user_metadata.dark_mode (Auth, hors table) = préférence dark/light.
                       ⚠️ Ne jamais UPDATE les colonnes sensibles directement → RPCs.
profiles_private      — push_token uniquement. RLS owner-only + service_role.
ootds                 — Posts (tenues). image_url, scores IA (note /100 depuis v3, score_scale
                       marque l'échelle), caption, audio, is_public (Feed), styles, visible_scores.
likes / comments      — Inchangés.
friendships           — Concept INDÉPENDANT des compétitions (Top 3 amis, sélection de membres
                       à la création). PK(user_id, friend_id). user_id=demandeur.
flammes / snaps       — Restent en base (non purgées) mais plus aucun code n'écrit dedans.
competitions          — Groupes nommés. Pas de policy INSERT directe (RPC uniquement).
competition_members   — Appartenance. PK(competition_id, user_id). last_read_at = curseur non-lu.
ootd_competitions     — Association tenue × compétition (many-to-many). user_id/created_at
                       dénormalisés depuis ootds.
competition_invites   — Liens d'invitation (tout membre peut créer/révoquer).
competition_messages  — Chat de groupe. sender_id → profiles(id) (pas auth.users, voir plus haut).
subscriptions         — Stripe (Plus/Elite). RLS read-only. Mutations via service_role uniquement.
web_push_subscriptions — endpoint/p256dh/auth Web Push. RLS owner-only.
analyze_rate_limit    — rate-limit 5 req/min par user (analyze-outfit uniquement désormais).
stories               — SUPPRIMÉE (table, bucket, cron) — 2026-09-22.
```

**Storage** : `avatars` (`<uid>/avatar.jpg`), `ootds` (`<uid>/outfit_<ts>.{jpg,webp}` + `messages/<uid>/<ts>.jpg` + `audio/<uid>/<ts>.{webm,m4a}`). Le bucket `stories` n'existe plus.

---

## Collaboration multi-agents IA

Chaque agent qui prend un ticket doit :

1. **Lire CLAUDE.md, ARCHITECTURE.md et TACHES.md** avant toute intervention
2. **Vérifier git status** — les fichiers modifiés non commités peuvent être en cours
3. **Ne pas modifier le schéma SQL sans ajouter une migration** dans `supabase/migrations/`
4. **Ne pas introduire de state global** (pas Redux, pas Zustand) — state local dans les écrans
5. **Ne pas changer la langue de l'UI** — tout en français
6. **Mettre à jour TACHES.md / ARCHITECTURE.md / WORKFLOW.md** à la fin de chaque intervention si l'architecture a changé
7. **Ne jamais committer** `.env`, `.claude/`, `.agents/`, `.mcp.json`, `skills-lock.json`, `supabase/.temp/` — tous gitignorés, ne jamais `git add -A`
8. **Upload de fichiers** : `fetch(uri).blob()` (fonctionne Android + iOS + web)
9. **Utilitaires** : toujours importer depuis `lib/utils` / `lib/logoConfig` / etc. — jamais copier localement
10. **Mutations économiques** : RPCs SECURITY DEFINER uniquement
11. **Nouvelle table "rejoignable"** : jamais de policy INSERT directe pour `authenticated`, toujours une RPC qui valide la légitimité avant d'ajouter une ligne (voir `competition_members`)
12. **FK vers profiles** : si une colonne doit être embed-jointe avec `profiles(...)` côté client, elle référence `profiles(id)`, jamais `auth.users(id)`
13. **Modification d'une Edge Function** : le `git push` ne suffit pas sur ce self-host — signaler explicitement qu'une resynchro manuelle côté serveur est nécessaire (voir section dédiée)
14. **CORS** : toute nouvelle Edge Function doit utiliser `Deno.env.get('APP_ORIGIN') ?? '*'`
15. **Dark/light** : jamais stocké dans `profiles` — c'est `user_metadata.dark_mode` via `supabase.auth.updateUser()`, lu/écrit uniquement via `useTheme()`

### Répartition logique des domaines (pour parallélisation)

| Domaine | Fichiers concernés |
|---------|-------------------|
| Auth & profil | `AuthScreen.js`, `ResetPasswordScreen.js`, `lib/ensureProfile.js`, `lib/notifications.js`, `lib/pwa.js`/`lib/pwa.web.js`, `lib/downloadImage.js` |
| Feed & social | `FeedScreen.js`, `components/FeedCommentsModal.js`, `components/HeartOverlay.js`/`.web.js`, `components/Skeleton.js` |
| Analyse IA | `AccueilScreen.js` (capture + analyse), `CustomizationScreen.js`, `supabase/functions/analyze-outfit/`, `supabase/functions/deezer-search/` |
| Compétitions | `AccueilScreen.js` (capture + bandeau), `CompetitionsListScreen.js`, `CreateCompetitionScreen.js`, `ShareToCompetitionScreen.js`, `CompetitionScreen.js` (classement + galerie + chat), `JoinCompetitionScreen.js`, `PalmaresScreen.js`, `lib/pendingOutfit.js`, `lib/activeChat.js`, `lib/competitionUtils.js`, migrations `2026091*`/`2026092*`/`20260925*` liées aux compétitions |
| Amis (indépendant des compétitions) | `FriendsScreen.js`, table `friendships` |
| Récap & cosmétiques | `RecapScreen.js`, `ShopScreen.js`, `lib/themeContext.js`, `lib/logoConfig.js`, `supabase/functions/create-*`, `supabase/functions/stripe-webhook/` |
| Notifications | `lib/notifications.js`, `lib/pwa.js`/`lib/pwa.web.js`, `lib/webPush.js`/`lib/webPush.web.js`, `supabase/functions/send-web-push/` |
| Utilitaires partagés | `lib/utils.js`, `lib/toastContext.js`, `lib/haptics.js`, `components/Bouncy.js`/`.web.js` |
| Infrastructure | `App.js`, `lib/supabase.js`, `lib/env.js`, `supabase/migrations/` |
| Composants UI | `components/Button.js`, `components/Avatar.js`, `components/AppHeader.js`, `components/MediaCropEditor.js` |

> `AccueilScreen.js` est partagé entre les domaines "Analyse IA" et "Compétitions" — coordonner si modification simultanée. `RecapScreen.js` a absorbé l'ancien `ProfilScreen.js` (Réglages + galerie + Top 3), donc le domaine "Récap & cosmétiques" couvre maintenant aussi tout ce qui touchait l'ancien "Auth & profil" côté affichage profil.
