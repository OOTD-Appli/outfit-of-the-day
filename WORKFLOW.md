# WORKFLOW.md — Développement et déploiement OOTD

## Prérequis

- Node.js 18+
- npm (livré avec Node)
- Compte Expo / EAS CLI : `npm install -g eas-cli`
- Compte Supabase avec un projet actif
- Supabase CLI : `npm install -g supabase` (requis pour déployer les Edge Functions)
- Compte Groq (https://console.groq.com) — la clé API est stockée comme secret Supabase, **jamais dans le bundle client**

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
# → NE PAS ajouter EXPO_PUBLIC_GROQ_API_KEY ici, elle est stockée dans les secrets Supabase

# 4. Appliquer les migrations Supabase (voir section ci-dessous)

# 5. Déployer l'Edge Function analyze-outfit (voir section ci-dessous)
```

---

## Lancer l'app en dev

```bash
npm start          # Expo dev server (QR code → Expo Go)
npm run android    # Lancer directement sur émulateur/device Android
npm run ios        # Lancer sur simulateur iOS (Mac uniquement)
```

> **Expo Go vs build natif** : les notifications push ne fonctionnent pas dans Expo Go (le code le détecte via `Constants.appOwnership === 'expo'` et skip l'enregistrement push). Pour tester les notifs, utiliser un build preview via EAS.

---

## Migrations Supabase

Les fichiers SQL sont dans `supabase/migrations/`. Ordre d'application sur un **projet vide** :

| Fichier | Contenu |
|---------|---------|
| `20260510120000_initial_schema.sql` | Schéma complet (fresh install) |
| `20260510121500_existing_project_align.sql` | Migrations si tables existent déjà (idempotent) |
| `20260511130000_comments.sql` | Table `comments` |
| `20260522140000_messages_stories.sql` | Tables `messages` et `stories`, bucket `stories` |
| `20260522150000_add_caption_to_ootds.sql` | Colonne `caption` sur `ootds` |
| `20260523160000_stories_video.sql` | Support vidéo stories + colonnes `overlay_text`, `caption` |
| `20260525170000_daily_credits.sql` | Système crédits quotidiens + RPC `consume_daily_credit` |
| `20260525180000_shop_columns.sql` | Colonnes shop dans `profiles` (passes, cosmétiques) |
| `20260528100000_security_hardening.sql` | Durcissement sécurité (trigger guard + RPCs SECURITY DEFINER + RLS renforcées) |
| `20260529120000_stories_gc.sql` | Garbage collector : trigger `AFTER DELETE` stories → supprime `storage.objects` + job pg_cron horaire |

**Sur un projet vide** : exécuter `initial_schema.sql` puis toutes les migrations suivantes dans l'ordre.

**Sur un projet existant** : utiliser `existing_project_align.sql` (IF NOT EXISTS, idempotent) puis les migrations à partir de `20260511130000_comments.sql`.

**Ne jamais re-exécuter** `initial_schema.sql` si les tables existent déjà.

> Exécuter via SQL Editor sur app.supabase.com ou via CLI : `supabase db push`

---

## Edge Functions Supabase

### Premier déploiement

```bash
# 1. Se connecter au CLI Supabase (via token personnel)
# Créer un token sur : https://supabase.com/dashboard/account/tokens
export SUPABASE_ACCESS_TOKEN="sbp_..."   # Linux/macOS
$env:SUPABASE_ACCESS_TOKEN = "sbp_..."   # PowerShell Windows

# 2. Lier le projet local au projet Supabase distant
supabase link --project-ref jjqisirnrodilxfkcbiq

# 3. Définir le secret GROQ_API_KEY
supabase secrets set GROQ_API_KEY=gsk_...

# 4. Déployer la fonction
supabase functions deploy analyze-outfit --no-verify-jwt
# Note: --no-verify-jwt laisse Supabase gérer la vérif JWT automatiquement
# La fonction vérifie elle-même la présence du header Authorization
```

### Mises à jour

```bash
# Redéployer après modification de supabase/functions/analyze-outfit/index.ts
supabase functions deploy analyze-outfit --no-verify-jwt
```

### Vérifier les secrets

```bash
supabase secrets list
# Doit afficher GROQ_API_KEY (valeur masquée)
```

---

## Build et déploiement (EAS)

```bash
# APK Android (test / distribution interne)
npm run eas:build:preview
# → produit un .apk téléchargeable depuis expo.dev

# AAB Android (Play Store)
npm run eas:build:prod
```

**Variables d'env pour les builds EAS** (à définir sur expo.dev → Project Settings → Environment Variables) :
```
EXPO_PUBLIC_SUPABASE_URL       # URL du projet Supabase
EXPO_PUBLIC_SUPABASE_ANON_KEY  # Clé anon Supabase
```

> **Ne pas ajouter `EXPO_PUBLIC_GROQ_API_KEY`** — la clé Groq est un secret Supabase côté serveur, elle ne doit jamais être dans le bundle mobile.

Le versioning est géré par EAS (remote) : `eas.json → cli.appVersionSource: "remote"`.

---

## Flow de développement — cycle habituel

```
1. Lire TACHES.md et CLAUDE.md
2. Créer une branche : git checkout -b feat/nom-feature
3. Implémenter le changement
4. Vérifier la checklist ci-dessous
5. Mettre à jour TACHES.md (marquer terminé / ajouter nouveaux items)
6. Commit : git add -p && git commit -m "description"
```

---

## Checklist avant commit

**Hooks React**
- [ ] `const { showToast } = useToast()` au niveau top du composant (jamais dans un callback)
- [ ] `const { theme } = useTheme()` si le composant affiche des couleurs
- [ ] `ToastProvider` + `ThemeProvider` enveloppent bien le retour de `App()` pour les deux branches

**Imports React Native**
- [ ] `Alert` importé depuis `react-native` dans chaque fichier qui l'utilise
- [ ] `TouchableOpacity`, `Image`, `ActivityIndicator` importés si utilisés dans le JSX

**Utilitaires partagés**
- [ ] `computeNiveau`, `computeLevelInfo`, `timeAgo` → importer depuis `lib/utils` (pas de copie locale)
- [ ] `getLogoConfig` → importer depuis `lib/logoConfig` pour afficher les logos/cadres

**Invariants métier**
- [ ] Les paires flammes passent par `flammeOrderedIds()` avant insert/query (user1 < user2)
- [ ] `hasSnapUsedTodayForPair()` vérifié avant tout insert dans `snaps`
- [ ] Streak flammes : comparaison par jours calendaires ISO (pas fenêtre 24h glissante)
- [ ] Upload de fichier (galerie, caméra) : utiliser `fetch(uri).blob()` — compatible Android et iOS

**Sécurité**
- [ ] Jamais de clé API dans le code client ou dans `.env` versionné
- [ ] Toute nouvelle Edge Function vérifie la présence du header `Authorization`
- [ ] Nouveaux champs dans les tables → migration SQL dans `supabase/migrations/`
- [ ] Ne jamais appeler `supabase.from('profiles').update({points, niveau, has_*_pass, daily_credits, unlocked_*, active_*})` directement — passer par les RPCs SECURITY DEFINER (`award_points_for_ootd`, `buy_pass`, `buy_cosmetic`, `equip_cosmetic`)
- [ ] Ne jamais supprimer des stories côté client — la suppression côté serveur (pg_cron `cleanup_expired_stories`) déclenche automatiquement le trigger qui nettoie `storage.objects`
- [ ] `savePushToken` écrit dans `profiles_private`, pas dans `profiles`
- [ ] Toute mutation économique (points, passes, crédits, cosmétiques) passe par un RPC, jamais par UPDATE direct

**UI**
- [ ] Textes UI en français
- [ ] Couleurs via `theme.xxx` — pas de couleurs hardcodées dans les composants thématisés
- [ ] Thème dark Shop (ShopScreen garde ses couleurs propres : NEON `#39FF14`, BG `#0a0a0a`)
- [ ] Pas de `alert()` natif — utiliser `showToast()` ou `Alert.alert()`
- [ ] Pas de bouton qui accorde des points sans validation réelle (pas de `claimPointsPack`)

---

## Architecture des données en bref (pour les agents)

```
profiles          — 1 ligne par user (auth.users). Créée par ensureProfile().
                   Contient : points, niveau, daily_credits, crédits, passes,
                   unlocked_themes[], unlocked_logos[], active_theme, active_logo.
                   ⚠️ Ne jamais UPDATE les colonnes sensibles directement — utiliser les RPCs.
profiles_private  — Données privées par user : push_token. Non lisible par les autres users (RLS stricte).
ootds             — Posts (tenues). Lié à profiles via user_id. Colonnes caption, scores IA.
likes             — Likes sur les ootds. UNIQUE(user_id, ootd_id).
comments          — Commentaires sur ootds. Lié à profiles.id. Body 1–1000 chars.
friendships       — Demandes d'amitié (pending → accepted). PK(user_id, friend_id).
flammes           — Streaks entre amis. PK sur (user1_id, user2_id) avec user1 < user2.
                   Streak incrémenté par jours calendaires (pas fenêtre 24h glissante).
messages          — Textes/photos éphémères (24h) entre amis. Images dans bucket ootds/messages/.
stories           — Stories vidéo éphémères (24h). Bucket stories. Supportent overlay_text + caption.
```

Storage buckets : `avatars` (`<uid>/avatar.jpg`), `ootds` (`<uid>/outfit_<ts>.jpg` + `messages/<uid>/<ts>.jpg`), `stories` (`<uid>/<ts>.mp4`).

---

## Collaboration multi-agents IA

Chaque agent qui prend un ticket doit :

1. **Lire CLAUDE.md en entier** — surtout la section bugs critiques
2. **Vérifier git status** — les fichiers modifiés non commités peuvent être cassés
3. **Ne pas modifier le schéma SQL sans ajouter une migration** dans `supabase/migrations/` — nommer `YYYYMMDDHHMMSS_description.sql`
4. **Ne pas introduire de state global** (pas Redux, pas Zustand) — state local dans les écrans
5. **Ne pas changer la langue de l'UI** — tout en français
6. **Mettre à jour TACHES.md** à la fin de chaque intervention
7. **Ne pas committer `.env`** — il est gitignored, c'est intentionnel
8. **Upload de fichiers** : utiliser `fetch(uri).blob()` (fonctionne Android + iOS, y compris URI `content://`)
9. **Utilitaires** : toujours importer depuis `lib/utils` plutôt que copier les fonctions localement
10. **Mutations économiques** : ne jamais écrire directement sur les colonnes sensibles de `profiles` — utiliser les RPCs SECURITY DEFINER uniquement
11. **Push token** : `savePushToken()` cible `profiles_private`, jamais `profiles`

### Répartition logique des domaines (pour parallélisation)

| Domaine | Fichiers concernés |
|---------|-------------------|
| Auth & profil | `AuthScreen.js`, `ProfilScreen.js`, `lib/ensureProfile.js`, `lib/notifications.js` |
| Feed & social | `FeedScreen.js`, `components/FeedCommentsModal.js` |
| Analyse IA | `AccueilScreen.js` (bloc `analyzeOutfit`), `supabase/functions/analyze-outfit/` |
| Flammes & messages | `FlammesScreen.js`, `AccueilScreen.js` (bloc `sendOutfitToAllFlammes`), `lib/flammesUtils.js` |
| Shop & cosmétiques | `ShopScreen.js`, `lib/themeContext.js`, `lib/logoConfig.js` |
| Utilitaires partagés | `lib/utils.js`, `lib/toast.js`, `lib/toastContext.js` |
| Infrastructure | `App.js`, `lib/supabase.js`, `lib/env.js`, `supabase/migrations/` |
| Composants UI | `components/Button.js`, `components/Avatar.js`, `components/FeedCommentsModal.js` |

> Les domaines "Feed" et "Flammes" partagent `lib/supabase.js` et `lib/toastContext.js` — ne pas les modifier en parallèle sans coordination.
