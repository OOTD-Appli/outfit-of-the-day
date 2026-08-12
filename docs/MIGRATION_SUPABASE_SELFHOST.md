# Plan de migration — Supabase Cloud → self-host (`supabase.myback.fr`)

> Rédigé le 2026-08-12. Cible : instance self-host, stack officielle `supabase/supabase` (docker-compose) sur `supabase.myback.fr`. Source : projet Supabase Cloud actuel (ref `jjqisirnrodilxfkcbiq`, région West EU Ireland).
>
> **Ce document est un plan — aucune commande n'a été exécutée.** Chaque section À FAIRE liste les commandes exactes ; les valeurs entre `<...>` sont à remplacer avant exécution. Ne jamais coller de clé secrète dans une conversation ou un fichier versionné.

---

## 0. Pourquoi ce plan avant d'agir

OOTD est en production avec de vrais utilisateurs (comptes, tenues publiées, abonnements Stripe actifs). Une migration Supabase touche 5 systèmes différents qui doivent tous basculer de façon cohérente : base Postgres (schéma + données), Auth (utilisateurs + sessions), Storage (fichiers binaires), Edge Functions (secrets inclus), et les clients (app mobile + web) qui pointent vers l'URL du projet. Un downtime mal maîtrisé ou un webhook Stripe mal reconfiguré peut couper les paiements ou déconnecter tous les utilisateurs.

---

## 1. Inventaire — ce qui doit migrer

| Composant | Détail | Volume approximatif |
|---|---|---|
| Schéma SQL | 38 fichiers dans `supabase/migrations/` (rejouables tels quels) | — |
| Données Postgres | Tables `public.*` (profiles, ootds, messages, flammes, subscriptions, etc.) | Dépend du nombre d'utilisateurs réels |
| `auth.users` + sessions | Comptes email/mot de passe (hash bcrypt), métadonnées | 1 ligne / utilisateur |
| Storage — 3 buckets | `avatars` (public), `ootds` (public, images+audio), `stories` (public, vidéo/image) | Fichiers binaires réels, peut être volumineux |
| Edge Functions (8) | `analyze-outfit`, `contextual-analysis`, `deezer-search`, `create-checkout-session`, `create-payment-session`, `create-portal-session`, `stripe-webhook`, `send-web-push` | Code + secrets |
| Secrets Edge Functions | `GEMINI_API_KEY`, `GROQ_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_ELITE`, `STRIPE_PRICE_FLAME_FREEZE`, `STRIPE_PRICE_POINTS_2000`, `APP_REDIRECT_URL`, `APP_ORIGIN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | 13 secrets |
| pg_cron | Job horaire de purge des stories expirées (migration `20260529120000_stories_gc.sql`, activé manuellement via SQL Editor à l'origine) | 1 job |
| Config Stripe externe | Webhook endpoint pointant vers l'URL Edge Function actuelle | 1 endpoint à recréer |
| Env clients | `.env` local, variables Vercel (web), variables EAS (mobile) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_VAPID_PUBLIC_KEY` |

**Pas concerné par la migration** : le code applicatif lui-même ne référence l'URL/clé Supabase que via `lib/env.js` / `lib/supabase.js`, lues depuis les variables d'environnement — aucune URL de projet n'est codée en dur dans `screens/`, `components/` ou `lib/` (vérifié). Seuls les **secrets Edge Functions** et les **variables d'environnement client** doivent changer.

---

## 2. Prérequis à vérifier sur `supabase.myback.fr` AVANT de commencer

Stack officielle docker-compose confirmée — points à valider un par un avant la première étape d'exécution :

- [ ] **Extension `pg_cron` active** : l'image `supabase/postgres` l'inclut, mais le docker-compose officiel nécessite `shared_preload_libraries = 'pg_cron,...'` dans `postgresql.conf` **et** `CREATE EXTENSION IF NOT EXISTS pg_cron;`. Sans ça, la migration `20260529120000_stories_gc.sql` s'applique mais le job de purge ne tournera jamais (stories orphelines qui s'accumulent en Storage).
- [ ] **Backend Storage configuré** : docker-compose officiel supporte `STORAGE_BACKEND=file` (disque local du serveur) ou `STORAGE_BACKEND=s3`. Si `file`, s'assurer que le volume Docker est sur un disque avec sauvegarde (pas de redondance S3 automatique) et dimensionné pour la volumétrie attendue (photos + vidéos de stories).
- [ ] **Edge Runtime actif** (`supabase-edge-runtime` dans le docker-compose) — nécessaire pour les 8 fonctions. Vérifier qu'il tourne et que `supabase functions deploy` fonctionne en pointant dessus avant de migrer quoi que ce soit d'autre.
- [ ] **Version GoTrue (Auth) compatible** : le hash des mots de passe (`auth.users.encrypted_password`) est du bcrypt, portable entre versions récentes de GoTrue. Vérifier que la version self-host n'est pas antérieure à celle utilisée par Supabase Cloud (sinon prévoir un reset de mot de passe forcé pour tous les utilisateurs en filet de sécurité).
- [ ] **Accès direct Postgres** (pour `pg_dump`/`pg_restore`) : confirmer le port 5432 (ou le port custom du compose) joignable depuis la machine qui exécutera la migration — pas seulement via l'API REST/PgBouncer.
- [ ] **Certificat TLS valide sur `supabase.myback.fr`** (HTTPS) — requis pour que les clients mobiles (iOS/Android) acceptent les requêtes ; un cert auto-signé cassera l'app en production.

---

## 3. Séquence de migration (dans l'ordre)

### Étape 1 — Lier le CLI à la nouvelle instance (sans toucher au projet actuel)

Travailler dans un **clone séparé** du repo (ou une branche dédiée) pour ne pas mélanger les liaisons `supabase link` des deux projets.

```bash
git clone https://github.com/OOTD-Appli/outfit-of-the-day.git ootd-migration
cd ootd-migration
npx supabase login   # ou export SUPABASE_ACCESS_TOKEN=... si le self-host expose un token compatible CLI
npx supabase link --project-ref <ref-ou-url-instance-self-host>
```

> Si l'instance self-host n'expose pas l'API de management Supabase (utilisée par `supabase link`), il faudra piloter le schéma directement en `psql`/`pg_restore` plutôt que via `supabase db push` — à confirmer une fois l'accès CLI testé.

### Étape 2 — Rejouer le schéma (38 migrations, structure uniquement, pas de données)

```bash
npx supabase db push
```

Vérifier ensuite dans le SQL Editor (ou `psql`) de la nouvelle instance :
```sql
select extname from pg_extension where extname = 'pg_cron';
select * from cron.job;  -- doit lister le job de purge stories après la migration 20260529120000
```
Si absent, réappliquer manuellement le bloc `cron.schedule(...)` de `20260529120000_stories_gc.sql` (déjà noté comme étape manuelle dans WORKFLOW.md sur Supabase Cloud aussi).

### Étape 3 — Geler les écritures côté source (fenêtre de maintenance)

Le seul moyen simple sans downtime applicatif complexe à mettre en place : choisir une fenêtre de faible trafic et **désactiver temporairement l'accès** en mettant l'app en mode maintenance (ex. écran de maintenance statique sur Vercel, build EAS non poussé) le temps du transfert des données. Durée estimée dépendante du volume Storage (souvent le plus long).

### Étape 4 — Migrer les données Postgres (schémas `public` + `auth` + `storage` métadonnées)

Depuis la machine de migration, avec la chaîne de connexion directe des DEUX projets (Dashboard Supabase Cloud → Settings → Database → Connection string ; puis équivalent self-host) :

```bash
# Dump des données uniquement (le schéma a déjà été rejoué à l'étape 2)
pg_dump "<CONNECTION_STRING_SOURCE>" \
  --data-only --disable-triggers \
  --schema=public --schema=auth --schema=storage \
  -f ootd_data.sql

# Restauration sur la nouvelle instance
psql "<CONNECTION_STRING_CIBLE>" -f ootd_data.sql
```

Points d'attention :
- `--disable-triggers` évite que le trigger `profiles_guard_sensitive_trigger` ou les triggers Storage GC ne s'exécutent pendant l'import brut.
- Le schéma `storage` ne contient que les **métadonnées** (chemins, tailles, MIME) — les fichiers binaires eux-mêmes sont migrés à l'étape 5.
- Vérifier après import : `select count(*) from auth.users;`, `select count(*) from public.profiles;`, `select count(*) from public.ootds;` — comparer aux comptes de la source.

### Étape 5 — Migrer les fichiers Storage (les 3 buckets)

Les métadonnées sont dans la base (étape 4), mais les objets binaires doivent être copiés bucket par bucket via les API Storage (source → téléchargement, cible → upload), car le backend physique diffère (S3 Supabase Cloud vs `file`/`s3` self-host).

Approche recommandée : petit script Node ponctuel (à écrire au moment de l'exécution, pas maintenant) utilisant `@supabase/supabase-js` :
1. `supabase.storage.from('<bucket>').list()` récursif sur la source pour lister tous les chemins.
2. Pour chaque chemin : `download()` depuis la source, `upload()` vers la cible avec le même chemin exact (les URLs publiques stockées dans `ootds.image_url`, `messages.image_url`, etc. dépendent de `<uid>/<fichier>` — préserver l'arborescence à l'identique).
3. Faire les 3 buckets (`avatars`, `ootds`, `stories`) dans cet ordre de priorité (avatars = petit volume, rapide à valider le script ; ootds = gros volume ; stories = volume variable + TTL 24h, les stories expirées pendant la fenêtre de maintenance n'ont pas besoin d'être migrées).

> ⚠️ Les URLs publiques stockées en base (`https://<ref>.supabase.co/storage/v1/object/public/...`) pointent vers l'ancien domaine. Après bascule des buckets vers le nouveau host, soit (a) une redirection/reverse-proxy fait pointer l'ancien domaine vers le nouveau le temps que les URLs en base soient réécrites, soit (b) un script UPDATE SQL réécrit `image_url`/`avatar_url`/etc. avec le nouveau domaine avant la bascule finale des clients. Décision à prendre selon si l'ancien projet Cloud reste actif un moment (option a plus simple) ou est décommissionné immédiatement (option b nécessaire).

### Étape 6 — Redéployer les Edge Functions + secrets sur la nouvelle instance

```bash
npx supabase secrets set \
  GEMINI_API_KEY=<...> \
  GROQ_API_KEY=<...> \
  STRIPE_SECRET_KEY=<...> \
  STRIPE_WEBHOOK_SECRET=<...>  `# nouvelle valeur, voir étape 7` \
  STRIPE_PRICE_PLUS=<...> \
  STRIPE_PRICE_ELITE=<...> \
  STRIPE_PRICE_FLAME_FREEZE=<...> \
  STRIPE_PRICE_POINTS_2000=<...> \
  APP_REDIRECT_URL=ootd://shop \
  APP_ORIGIN=https://ootd-fr.vercel.app \
  VAPID_PUBLIC_KEY=<...> \
  VAPID_PRIVATE_KEY=<...> \
  VAPID_SUBJECT=mailto:<...>

npx supabase functions deploy analyze-outfit
npx supabase functions deploy contextual-analysis
npx supabase functions deploy deezer-search --no-verify-jwt
npx supabase functions deploy create-checkout-session
npx supabase functions deploy create-payment-session
npx supabase functions deploy create-portal-session
npx supabase functions deploy stripe-webhook --no-verify-jwt
npx supabase functions deploy send-web-push
```

### Étape 7 — Reconfigurer le webhook Stripe

Le endpoint actuel dans Stripe Dashboard pointe vers `https://jjqisirnrodilxfkcbiq.supabase.co/functions/v1/stripe-webhook`. Créer un **nouveau** endpoint pointant vers `https://supabase.myback.fr/functions/v1/stripe-webhook` (mêmes événements : `checkout.session.completed`, `customer.subscription.created/updated/deleted`), récupérer le nouveau `STRIPE_WEBHOOK_SECRET` (`whsec_...`) et le mettre à jour dans les secrets (étape 6). **Ne pas supprimer l'ancien endpoint avant d'avoir confirmé que le nouveau reçoit bien les événements en test.**

### Étape 8 — Basculer les clients

- `.env` local (dev) : `EXPO_PUBLIC_SUPABASE_URL=https://supabase.myback.fr`, `EXPO_PUBLIC_SUPABASE_ANON_KEY=<nouvelle clé anon>`.
- **Vercel** (Project → Settings → Environment Variables) : mêmes deux variables + `EXPO_PUBLIC_VAPID_PUBLIC_KEY` si la paire VAPID change. Puis `vercel --prod` pour rebuilder avec les nouvelles valeurs (inlinées dans le bundle web).
- **EAS** (expo.dev → Project → Environment Variables, profils `preview`/`production`) : mêmes variables. **Nécessite un nouveau build EAS** (`npm run eas:build:prod`) — les valeurs sont figées dans le binaire à la compilation, un simple changement de variable ne suffit pas pour les utilisateurs ayant déjà l'app installée.

### Étape 9 — Tests avant réouverture

- [ ] Signup + login (nouveau compte + compte migré existant)
- [ ] Upload avatar, analyse d'une tenue (Gemini + fallback Groq), publication feed
- [ ] Affichage d'une photo migrée depuis l'ancien Storage (vérifier que l'URL résolue est la bonne)
- [ ] Chat : envoi message texte/photo/vocal, realtime (2 comptes de test)
- [ ] Achat Stripe test (`create-checkout-session`) + réception webhook confirmée en base (`subscriptions` mise à jour)
- [ ] Notification push web (`send-web-push`)
- [ ] Job pg_cron : vérifier qu'une story expirée est bien purgée après l'heure du job

### Étape 10 — Réouverture + fenêtre de sécurité

Lever le mode maintenance. Garder le projet Supabase Cloud actuel **actif mais gelé en écriture** (ou en lecture seule) pendant 7–14 jours avant décommissionnement définitif, le temps de confirmer qu'aucune donnée/fichier n'a été oublié.

---

## 4. Plan de rollback

Si un problème critique apparaît après bascule (Auth cassée, Storage inaccessible, paiements en échec) :
1. Remettre `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` sur Vercel vers l'ancien projet Cloud + redeploy (`vercel --prod`) — rétablit le web immédiatement.
2. Mobile : plus délicat (nécessite un nouveau build EAS ou un rollback de version sur les stores) — c'est le facteur qui doit driver la durée de la fenêtre de tests avant d'annoncer la bascule mobile comme définitive.
3. Ne décommissionner l'ancien projet Cloud qu'après la fenêtre de sécurité de l'étape 10.

---

## 5. Ce qui reste à confirmer avant exécution

- [ ] `supabase link`/`supabase db push` fonctionnent-ils contre `supabase.myback.fr`, ou faut-il piloter en `psql` pur (l'API de management self-host n'est pas toujours exposée) ?
- [ ] Volumétrie réelle des buckets Storage (détermine la durée de la fenêtre de maintenance et s'il faut paralléliser le script de copie).
- [ ] Décision sur les anciennes URLs Storage en base : redirection le temps de la transition, ou réécriture SQL immédiate (voir étape 5).
- [ ] Date/heure de la fenêtre de maintenance souhaitée.
