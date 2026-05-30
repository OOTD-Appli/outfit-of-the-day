# ARCHITECTURE.md — Référence technique OOTD

## Vue d'ensemble

Application mobile React Native / Expo. Architecture simple : **pas de state manager global**, chaque écran gère son propre state local. Supabase est la source de vérité (DB + Auth + Storage + Realtime + Edge Functions). L'IA (Groq) est appelée **exclusivement via une Edge Function Supabase** — la clé API n'est jamais exposée côté client.

```
┌─────────────────────────────────────────────────────────────────┐
│                      App mobile (Expo)                           │
│  ┌────────┐ ┌────────┐ ┌─────────┐ ┌────────┐ ┌────────────┐   │
│  │ Feed   │ │ Chat   │ │Analyse  │ │ Profil │ │   Shop     │   │
│  └───┬────┘ └───┬────┘ └────┬────┘ └───┬────┘ └─────┬──────┘   │
│      │          │           │          │             │           │
│  ┌───▼──────────▼───────────▼──────────▼─────────────▼────────┐ │
│  │               Supabase Client (lib/supabase.js)             │ │
│  └────────────┬────────────────────────────┬───────────────────┘ │
└───────────────│────────────────────────────│────────────────────-┘
                │                            │ Realtime
         ┌──────▼──────────────────┐         │ (messages INSERT)
         │   Supabase (BaaS)       │◄────────┘
         │  ┌─────────────────┐    │
         │  │ DB (Postgres+RLS│    │
         │  ├─────────────────┤    │
         │  │ Auth (email/pwd)│    │
         │  ├─────────────────┤    │
         │  │ Storage (buckets│    │
         │  ├─────────────────┤    │
         │  │ Edge Functions  ├────┼──► Groq API (vision LLM)
         │  │ analyze-outfit  │    │        (clé serveur-side
         │  └─────────────────┘    │         uniquement)
         └─────────────────────────┘
```

---

## Navigation

`App.js` implémente un **BottomTabNavigator à 5 onglets** dans `ThemedNavigator`. Le gardien d'auth est dans `App()` lui-même. `ThemeProvider` et `ToastProvider` enveloppent tout.

```
App.js
 ├── loading=true  → <ActivityIndicator>
 ├── session=null  → <ThemeProvider><ToastProvider><AuthScreen>
 └── session ok    → <ThemeProvider>
                       <ToastProvider>
                         <ThemedNavigator userId={session.user.id}>
                           ├── Accueil (🏠) → FeedScreen
                           ├── Chat    (💬) → FlammesScreen  ← badge non-lu (Realtime)
                           ├── Analyse (✨) → AccueilScreen
                           ├── Profil  (👤) → ProfilScreen
                           └── Shop    (🛍️) → ShopScreen
```

**ThemedNavigator** reçoit `userId` en prop :
- Souscrit à `supabase.channel` pour les INSERT sur `messages.receiver_id=userId`
- Incrémente `unreadCount` → `tabBarBadge` sur l'onglet Chat
- Efface le badge (`setUnreadCount(0)`) au tap de l'onglet via `listeners.tabPress`
- Couleurs de la tab bar depuis `useTheme()` (accent, fond, bordure)

**Auth flow** : `App.useEffect` appelle `supabase.auth.getSession()` au démarrage, puis écoute `onAuthStateChange`. La session est synchronisée dans `syncSession()` qui enchaîne `ensureUserProfile()` et l'enregistrement push.

---

## Thème et cosmétiques

### `lib/themeContext.js` — `ThemeProvider` + `useTheme()`
5 palettes : `default` (rose), `midnight` (bleu nuit), `emerald` (vert), `gold` (or), `sakura` (rose poudré).

Chaque thème expose : `accent`, `bg`, `card`, `border`, `textPri`, `textSub`, `tabBar`, `tabBorder`.

- `ThemeProvider` charge `active_theme` depuis `profiles` au changement de session
- `refreshTheme()` exporté pour `ShopScreen` (ré-applique après équipement)
- Tous les écrans font `const { theme } = useTheme()` et appliquent les couleurs inline

### `lib/logoConfig.js` — `getLogoConfig(logoId)`
5 logos : `default` (⭐), `diamond` (💎, bleu), `crown` (👑, or), `fire` (🔥, orange), `star` (🌟, jaune).

Chaque logo expose : `emoji`, `frameBorderColor` (couleur du cadre avatar), `postIcon` (icône sur les posts Feed), `badge` (emoji affiché à côté du pseudo).

---

## Écrans — détail fonctionnel

### AuthScreen (`screens/AuthScreen.js`)
- **Mode login** : `signInWithPassword` → `ensureUserProfile()` en fallback
- **Mode inscription** : `signUp` avec `options.data.username` → insert dans `profiles`
- Bascule login/signup via `isLogin` state
- Logo responsive : `logoSize = Math.min(Math.round(screenHeight * 0.17), 140)`
- Feedback : `const { showToast } = useToast()`

### AccueilScreen (`screens/AccueilScreen.js`)
Reçoit la prop `{ navigation }` de React Navigation (utilisée pour naviguer vers Shop).

**Phase 1 — Sélection image**
- `openImageSourcePicker()` : Alert.alert avec choix caméra/galerie
- `pickImageFromLibrary()` : expo-image-picker galerie, `base64: true`, qualité 0.8
- `takePicture()` : caméra arrière, mêmes paramètres. Permission refusée → `showToast()` (pas `alert()`)
- Ring responsive : `ringSize = Math.min(Math.round(screenWidth * 0.22), 96)`

**Crédits d'analyse**
- Colonnes `daily_credits` / `credits_reset_date` / `has_analysis_pass` / `has_ootd_plus_pass` dans `profiles`
- 2 crédits/jour sans pass, 20 avec pass (Analyse ou OOTD+)
- Si `credits === 0` : carte `noCreditsCard` avec couleurs du thème + bouton "Obtenir plus de crédits" → navigue vers Shop

**Phase 2 — Analyse IA**
- `analyzeOutfit()` : `supabase.functions.invoke("analyze-outfit", { body: { base64Image } })`
- `base64Image` = `data:image/jpeg;base64,{raw_base64}` (préfixe MIME obligatoire)
- Timeout : 25 secondes via `withTimeout()`
- Animations : fade + rise (resultFade/resultRise), barres de progression animées (barsProgress)

**Phase 3 — Publication**
- `publishToFeed()` : upload image → Storage `ootds/<uid>/outfit_<ts>.jpg` → insert `ootds` → **RPC `award_points_for_ootd(ootd_id)`** (points et niveau calculés et attribués côté serveur)
- `sendOutfitToAllFlammes()` : `fetchAcceptedFriendIds()` → upload mutualisé (`cachedPublicUrlRef`) → insert `snaps` pour chaque ami (skip si quota quotidien atteint) → update/insert `flammes.streak`

**Mapping scores IA → DB :**
```
IA:  global         fit           harmonie        detail
DB:  score_global   score_coupe   score_couleurs  score_tendance
```

### FeedScreen (`screens/FeedScreen.js`)
- **UX TikTok** : `FlatList` avec `pagingEnabled`, `snapToInterval=pageH`, `decelerationRate="fast"`, chaque item = plein écran
- **Fetch** : `ootds` joint `profiles(username, avatar_url, active_logo)`, `likes(id, user_id)`, `comments(count)`
- `useFocusEffect` : charge au 1er focus (avec loader), recharge silencieusement ensuite
- **Like optimiste** : update local immédiat → DB → rollback en cas d'erreur
- **Logo effects** : `getLogoConfig(item.profiles.active_logo)` → cadre avatar coloré, badge pseudo, icône post overlay
- **timeAgo** : importé depuis `lib/utils` (pas de copie locale)
- **Partage** : modale slide-up listant les amis → insert `messages` (nécessite amitié acceptée — RLS)
- **Commentaires** : délégués à `FeedCommentsModal`

### FlammesScreen (`screens/FlammesScreen.js`)
3 vues gérées par le state `view` : `'list'` | `'chat'`

**Vue list (défaut)**
- Liste des amis acceptés avec streak 🔥, logos appliqués sur tous les avatars
- Cercles de story en haut : tap → viewer modal (video_url ou image_url)
- "Ma story" : affiche ▶ si story active, + sinon
- Section "Demandes" en haut si demandes entrantes

**Vue search**
- Recherche par pseudo (`ilike '%query%'`) dès 2 caractères
- Actions contextuelles : Demander / Demandée (cancel) / Accepter+Refuser / Amis
- `relationForSearchProfile()` détermine l'état de la relation

**Vue chat**
- Header avec avatar (cadre logo), pseudo (badge logo), streak
- ScrollView des messages (bulles gauche/droite selon sender_id)
- Messages photo : taille responsive `msgImgSize = Math.round(screenWidth * 0.55)`
- Bouton 📸 → `sendPhotoMessage()` : `fetch(uri).blob()` → upload Storage `ootds/messages/<uid>/<ts>.jpg` → insert `messages`
- **Streak photo message** : comparaison par jours calendaires (pas fenêtre 24h glissante). `daysDiff = Math.round((new Date(nowDay) - new Date(lastSnapDay)) / 86400000)` — si ≤ 1 : incrément, sinon reset à 1.

**Stories**
- `postStory()` : ouvre la caméra vidéo (60s max) → preview modal avec overlay text + caption
- `publishStory()` : upload XHR FormData → Storage `stories/<uid>/<ts>.mp4` → insert `stories`
- Viewer story : Modal plein écran avec `<Video>` (expo-av) pour vidéo ou `<Image>` pour photo

**Logique amitié :**
```
friendships (user_id → friend_id, status: pending | accepted | declined)
La relation est asymétrique en DB mais l'app agrège les deux sens pour les amis acceptés.
acceptRequest() : UPDATE status='accepted' + ensureFlammesRow()
declineRequest() : DELETE (le destinataire supprime la ligne)
cancelOutgoing() : DELETE (le demandeur annule sa propre demande)
```

### ProfilScreen (`screens/ProfilScreen.js`)
- Fetch `profiles.*` + `ootds.*` au focus
- Avatar cliquable → galerie → `fetch(uri).blob()` → upload `avatars/<uid>/avatar.jpg` (upsert, cache-busting `?t=timestamp`)
- Avatar responsive : `avatarSize = Math.min(Math.round(screenWidth * 0.22), 90)`
- Logo effects : cadre avatar coloré, badge emoji à côté du pseudo
- Stats : nb tenues, score moyen, points
- **Niveau (formule exponentielle)** : `computeLevelInfo(pts)` importé depuis `lib/utils`. Seuil ×1.8 par niveau. Retourne `{ threshold, progressInLevel, percent }`
- Galerie grille 3 colonnes (`numColumns={3}`)
- Déconnexion : `supabase.auth.signOut()` → App.js détecte → retour AuthScreen

### ShopScreen (`screens/ShopScreen.js`)
Économie entièrement basée sur les **points OOTD** (pas d'IAP réels).

**Catalogues** :
- `THEMES` : 5 thèmes (default gratuit, 4 payants à **200 pts** ou inclus dans Pass OOTD+)
- `LOGOS` : 5 logos (default gratuit, 4 payants à **100 pts** ou inclus dans Pass OOTD+)
- `PASS_PRICES` : Pass Analyse **400 pts** (20 analyses/j), Pass OOTD+ **500 pts** (20 analyses/j + tous thèmes et logos)

**Flux d'achat (via RPCs SECURITY DEFINER)** :
- `buyPass(type)` → RPC `buy_pass(pass_type)` : valide les points côté serveur, active le flag pass, crédite 20 analyses/j
- `buyItem(itemType, itemId)` → RPC `buy_cosmetic(item_type, item_id)` : valide ownership et points, ajoute à `unlocked_themes` ou `unlocked_logos`
- `equipItem(itemType, itemId)` → RPC `equip_cosmetic(item_type, item_id)` : vérifie que l'article est possédé, met à jour `active_theme`/`active_logo`, déclenche `refreshTheme()`

> **Sécurité** : les colonnes financières de `profiles` sont protégées par le trigger `profiles_guard_sensitive_trigger`. Toute UPDATE directe depuis le client est silencieusement annulée — seules les RPCs SECURITY DEFINER peuvent les modifier.

**Section "Gagner des points"** : informatif uniquement (liste des activités rapportant des points). Aucun bouton accordant des points fictifs.

---

## Composants réutilisables

### `Button` (`components/Button.js`)
Props : `title`, `variant` (primary/secondary/outline), `loading`, `disabled`, `leftIcon`, `rightIcon`, `onPress`

### `Avatar` (`components/Avatar.js`)
Props : `uri`, `size` (défaut 80), `username` (initiale fallback), `loading`, `onPress`, `borderWidth`, `borderColor`

### `FeedCommentsModal` (`components/FeedCommentsModal.js`)
Props : `visible`, `ootdId`, `userId`, `onClose`, `onThreadCount(ootdId, count)`
- Modal `presentationStyle="pageSheet"` (iOS bottom sheet)
- Toutes les couleurs via `useTheme()` — aucune couleur hardcodée
- `timeAgo` importé depuis `lib/utils`
- Charge les commentaires depuis `comments` joint `profiles(username, avatar_url)`
- Suppression par long-press ou bouton (uniquement ses propres commentaires)

---

## Bibliothèques partagées (`lib/`)

### `lib/supabase.js`
Client unique, exporté comme `supabase`. Configuré avec `AsyncStorage` pour persister la session entre les lancements.

### `lib/utils.js`
Fonctions utilitaires partagées entre tous les écrans :
- `computeNiveau(pts)` → niveau entier (formule exponentielle ×1.8)
- `computeLevelInfo(pts)` → `{ threshold, progressInLevel, percent }` pour la barre de progression
- `timeAgo(date)` → chaîne relative en français ("à l'instant", "5 min", "2 h", "3 j")

> La formule `computeNiveau` est également répliquée côté serveur dans la fonction Postgres `compute_niveau(p_pts integer)` pour les RPCs SECURITY DEFINER. Les deux implémentations doivent rester synchronisées.

### `lib/themeContext.js` — `ThemeProvider` + `useTheme()`
- `useTheme()` retourne `{ theme, refreshTheme }` — **toujours destructurer**
- 5 palettes : `default`, `midnight`, `emerald`, `gold`, `sakura`
- Propriétés : `accent`, `bg`, `card`, `border`, `textPri`, `textSub`, `tabBar`, `tabBorder`
- Charge `active_theme` depuis `profiles` à l'init de session
- `refreshTheme()` : re-fetch depuis Supabase et met à jour le thème en mémoire

### `lib/logoConfig.js` — `getLogoConfig(logoId)`
- Retourne la config du logo ou le logo `default` si inconnu
- Chaque config : `{ emoji, frameBorderColor, postIcon, badge }`
- `frameBorderColor` : couleur du cadre avatar (null = pas de cadre)
- `postIcon` : icône overlay sur les posts FeedScreen (null = aucune)
- `badge` : emoji affiché à côté du pseudo (null = aucun)

### `lib/env.js`
Lit `process.env.EXPO_PUBLIC_*`. `requireEnv(name, value)` lève une erreur si `value` est falsy. Contient `supabaseUrl` et `supabaseAnonKey` — la clé Groq est gérée côté serveur.

### `lib/ensureProfile.js` — `ensureUserProfile()`
1. `getUser()` → si non authentifié, retourne `{ok:true, skipped:true}`
2. `select id from profiles where id=user.id` → si existe, OK
3. Si absent : tente insert avec `username` depuis `user_metadata`
4. Si conflit (23505) : retry avec `<base>_<uid8>` puis `user_<uid8>`
5. Retourne `{ok, created, error}`

### `lib/flammesUtils.js`
- `flammeOrderedIds(a, b)` → `{user1_id, user2_id}` avec user1 < user2
- `getLocalDayIsoRange()` → fenêtre minuit-minuit fuseau local
- `fetchAcceptedFriendIds(supabase, userId)` → liste dédupliquée des amis acceptés
- `hasSnapUsedTodayForPair(supabase, senderId, receiverId)` → `count >= 1`

### `lib/notifications.js`
- `registerForPushNotifications()` : permission → canal Android → token Expo Push. Utilise `console.warn` (jamais `alert()`)
- `savePushToken(token)` : **`UPSERT profiles_private(id, push_token)`** — écrit dans la table privée, jamais dans `profiles`
- `sendPushNotification(token, title, body)` : POST Expo Push API (à appeler depuis une Edge Function, pas directement côté client)
- Skip silencieux si web ou Expo Go

### `lib/toastContext.js` — `ToastProvider` + `useToast()`
- `useToast()` retourne `{ showToast, dismissToast, toasts }` — **toujours destructurer** : `const { showToast } = useToast()`
- Types : `info` (noir), `success` (vert), `warning` (jaune), `error` (rouge)
- Auto-dismiss après `duration` ms (défaut 3000)

> `lib/toast.js` est un event bus alternatif non-React, **non utilisé** dans l'app. À supprimer pour éviter la confusion avec `toastContext.js`.

---

## Edge Functions Supabase

### `supabase/functions/analyze-outfit/index.ts`
- **Déclenchement** : `supabase.functions.invoke("analyze-outfit", { body: { base64Image } })`
- **Auth** : vérifie la présence d'un header `Authorization` (JWT utilisateur). Retourne 401 sinon.
- **Clé Groq** : lue via `Deno.env.get('GROQ_API_KEY')` — stockée comme secret Supabase, jamais dans le bundle client
- **Validation entrée** :
  - `base64Image` requis, string non vide
  - Longueur ≤ 10 000 000 caractères (~7,5 Mo décodé)
  - Préfixe MIME valide : `data:image/jpeg;base64,`, `data:image/png;base64,` ou `data:image/webp;base64,`
- **Crédits** : RPC `consume_daily_credit(user_id)` — décrémente atomiquement, reset si nouveau jour
- **Appel Groq** : `POST https://api.groq.com/openai/v1/chat/completions`, modèle `meta-llama/llama-4-scout-17b-16e-instruct`, role `user`, temperature 0.8, max_tokens 500
- **Validation sortie** : vérifie `global`, `fit`, `harmonie`, `detail` (numbers), `explications` (strings), `conseil` (string ≥ 40 chars)
- **Réponse** : `{global, fit, harmonie, detail, explications, conseil, credits_remaining, max_credits}`

---

## Fonctions PostgreSQL (RPCs et trigger de sécurité)

### Trigger `profiles_guard_sensitive_trigger`
Trigger `BEFORE UPDATE` sur `profiles`. Toute UPDATE directe depuis le client Supabase sur les colonnes listées ci-dessous est **silencieusement annulée** (les valeurs reviennent à `OLD.*`).

Colonnes protégées : `points`, `niveau`, `has_analysis_pass`, `has_ootd_plus_pass`, `daily_credits`, `credits_reset_date`, `unlocked_themes`, `unlocked_logos`, `active_theme`, `active_logo`.

Les RPCs SECURITY DEFINER contournent cette protection via `set_config('app.bypass_profile_guard', 'on', true)` (flag LOCAL à la transaction, non accessible depuis le client PostgREST).

### `compute_niveau(p_pts integer)` — helper IMMUTABLE
Miroir de `lib/utils.js#computeNiveau`. Retourne le niveau entier. Utilisé par `award_points_for_ootd`.

### `consume_daily_credit(p_user_id uuid)` — SECURITY DEFINER
Appelée par l'Edge Function `analyze-outfit`. Vérifie `auth.uid() = p_user_id`, reset si nouveau jour, décrémente `daily_credits`. Retourne `jsonb {ok, credits, max_credits}`.

### `award_points_for_ootd(p_ootd_id uuid)` — SECURITY DEFINER
Appelée par `AccueilScreen.publishToFeed` après l'insert dans `ootds`. Lit `score_global` depuis la DB (clampe 1–10 même si le client a triché), calcule `points_earned = ROUND(score * 3)`, met à jour `points` et `niveau`. Retourne `jsonb {ok, points_earned, new_points, new_niveau}`.

### `buy_pass(pass_type text)` — SECURITY DEFINER
Appelée par `ShopScreen.buyPass`. Valide le type (`analysis` ou `ootdplus`), vérifie les points (400 ou 500), déduit, active le flag, crédite 20 analyses. Si `ootdplus` : déverrouille tous les thèmes et logos. Retourne `jsonb {ok, new_points}`.

### `buy_cosmetic(item_type text, item_id text)` — SECURITY DEFINER
Appelée par `ShopScreen.buyItem`. Valide le type (`theme` ou `logo`) et l'ID contre les listes connues, vérifie les points (200 ou 100), déduit, ajoute à `unlocked_themes`/`unlocked_logos`. Retourne `jsonb {ok, new_points}`.

### `equip_cosmetic(item_type text, item_id text)` — SECURITY DEFINER
Appelée par `ShopScreen.equipItem`. Vérifie que l'article est dans `unlocked_*` ou que `has_ootd_plus_pass = true`, puis met à jour `active_theme` ou `active_logo`. Retourne `jsonb {ok}`.

---

## Schéma de base de données

### `profiles`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | = auth.users.id (ON DELETE CASCADE) |
| username | text UNIQUE NOT NULL | |
| avatar_url | text | URL publique Storage bucket `avatars` |
| points | integer DEFAULT 0 | +score_global×3 à chaque publication (via RPC) |
| niveau | integer DEFAULT 1 | Formule exponentielle (×1.8 par niveau, via RPC) |
| daily_credits | integer DEFAULT 2 | Analyses restantes aujourd'hui |
| credits_reset_date | date | Date du dernier reset (YYYY-MM-DD) |
| has_analysis_pass | boolean DEFAULT false | Pass Analyse (400 pts) |
| has_ootd_plus_pass | boolean DEFAULT false | Pass OOTD+ (500 pts) |
| unlocked_themes | text[] DEFAULT ['default'] | Thèmes débloqués |
| unlocked_logos | text[] DEFAULT ['default'] | Logos débloqués |
| active_theme | text DEFAULT 'default' | Thème actif |
| active_logo | text DEFAULT 'default' | Logo actif |
| created_at | timestamptz | |

> **Colonnes protégées par trigger** : `points`, `niveau`, `has_*_pass`, `daily_credits`, `credits_reset_date`, `unlocked_*`, `active_theme`, `active_logo` — toute UPDATE directe est ignorée. Modifier uniquement via RPCs SECURITY DEFINER.

### `profiles_private`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | = auth.users.id (ON DELETE CASCADE) |
| push_token | text | Token Expo Push Notifications |

> **Politique RLS stricte** : `SELECT`, `INSERT`, `UPDATE` restreints à `id = auth.uid()`. Invisible pour les autres utilisateurs. `lib/notifications.js#savePushToken` écrit exclusivement dans cette table.

### `ootds`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| user_id | uuid | → auth.users |
| image_url | text | URL publique bucket `ootds` |
| score_global | numeric | IA: `global` |
| score_couleurs | numeric | IA: `harmonie` |
| score_coupe | numeric | IA: `fit` |
| score_tendance | numeric | IA: `detail` |
| conseil | text | Conseil personnalisé IA |
| caption | text | Légende optionnelle de l'utilisateur |
| created_at | timestamptz | |

### `likes`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| user_id | uuid | → auth.users |
| ootd_id | uuid | → ootds |
| created_at | timestamptz | |
| — | UNIQUE(user_id, ootd_id) | |

### `comments`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| ootd_id | uuid | → ootds |
| user_id | uuid | → profiles.id |
| body | text | CHECK: len > 0 ET <= 1000 |
| created_at | timestamptz | |

### `friendships`
| Colonne | Type | Notes |
|---------|------|-------|
| user_id | uuid | → auth.users (initiateur de la demande) |
| friend_id | uuid | → auth.users (destinataire) |
| status | text DEFAULT 'pending' | `'pending'` · `'accepted'` · `'declined'` |
| created_at | timestamptz | |
| — | PK(user_id, friend_id) | relation directionnelle en DB |
| — | CHECK user_id <> friend_id | |

> L'app agrège les deux directions pour retrouver les amis acceptés. `declineRequest` utilise DELETE (pas UPDATE vers 'declined').

### `flammes`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| user1_id | uuid | Toujours < user2_id (contrainte SQL) |
| user2_id | uuid | |
| streak | integer DEFAULT 0 | Jours consécutifs de snap |
| last_snap_at | timestamptz | Dernière date de snap |
| — | UNIQUE(user1_id, user2_id) | |
| — | CHECK user1_id < user2_id | **invariant critique** |

**Calcul du streak** : comparaison par jours calendaires ISO (YYYY-MM-DD). Si `daysDiff <= 1` : incrément, sinon reset à 1.

### `messages`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| sender_id | uuid | → auth.users |
| receiver_id | uuid | → auth.users |
| content | text | Texte optionnel |
| image_url | text | URL publique bucket `ootds` (chemin `messages/`) |
| created_at | timestamptz | |
| expires_at | timestamptz | now() + 24h (éphémère) |
| — | CHECK | `content IS NOT NULL OR image_url IS NOT NULL` |

### `snaps`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| sender_id | uuid | → auth.users |
| receiver_id | uuid | → auth.users |
| image_url | text | URL publique bucket `ootds` |
| created_at | timestamptz | |

### `stories`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| user_id | uuid | → auth.users |
| image_url | text | URL publique (photo story) — nullable si video_url présent |
| video_url | text | URL publique (vidéo story) — nullable si image_url présent |
| overlay_text | text | Texte superposé sur la vidéo |
| caption | text | Légende sous la story |
| created_at | timestamptz | |
| expires_at | timestamptz | now() + 24h (éphémère) |
| — | CHECK stories_has_media | `image_url IS NOT NULL OR video_url IS NOT NULL` |

---

## Politiques RLS (résumé)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| profiles | tous authentifiés | soi-même (`id=uid`) | soi-même (colonnes non-sensibles uniquement — trigger) | — |
| profiles_private | soi-même | soi-même | soi-même | — |
| ootds | tous authentifiés | soi-même | — | — |
| likes | tous authentifiés | soi-même | — | soi-même |
| comments | tous authentifiés | soi-même | — | soi-même |
| friendships | impliqué | demandeur (`user_id=uid`, `status='pending'`) | destinataire (`friend_id=uid`, `status pending→accepted/declined`) | les deux |
| flammes | impliqué (user1 ou user2) | impliqué | impliqué | — |
| messages | impliqué (sender ou receiver) | sender=uid **+ amitié acceptée** | — | sender=uid |
| snaps | impliqué (sender ou receiver) | sender=uid **+ amitié acceptée** | — | — |
| stories | auteur ou ami accepté + non expiré | user_id=uid | — | user_id=uid |

> **Note `ootds` DELETE** : aucune politique DELETE sur `ootds` — les tenues sont permanentes (pas de suppression depuis l'app).

---

## Storage Supabase

| Bucket | Visibilité | Politique INSERT | Chemins |
|--------|-----------|-----------------|---------|
| `avatars` | Public (lecture) | `<uid>/…` uniquement | `<uid>/avatar.jpg` |
| `ootds` | Public (lecture) | `<uid>/…` ou `snaps/<uid>/…` | `<uid>/outfit_<ts>.jpg` · `messages/<uid>/<ts>.jpg` |
| `stories` | Public (lecture) | `<uid>/…` uniquement | `<uid>/<ts>.mp4` |

> Toutes les politiques INSERT vérifient le premier segment du chemin (`split_part(name, '/', 1) = uid`). Un utilisateur ne peut pas écrire dans le répertoire d'un autre.

---

## Edge Function — Intégration Groq (IA)

- Endpoint interne : `supabase.functions.invoke("analyze-outfit", { body: { base64Image } })`
- Modèle : `meta-llama/llama-4-scout-17b-16e-instruct` (vision)
- Input : image en base64 `data:image/{jpeg|png|webp};base64,…` + prompt styliste (taille max ~7,5 Mo)
- Output : JSON strict `{global, fit, harmonie, detail, explications:{fit,harmonie,detail}, conseil, credits_remaining, max_credits}`
- Température : 0.8, max_tokens : 500
- La clé `GROQ_API_KEY` est un secret Supabase — **jamais dans le bundle APK**

---

## Design responsive

Tous les écrans utilisent `useWindowDimensions()` pour s'adapter à la taille de l'écran :

| Élément | Formule |
|---------|---------|
| Score ring (Accueil) | `Math.min(Math.round(screenWidth × 0.22), 96)` |
| Logo (Auth) | `Math.min(Math.round(screenHeight × 0.17), 140)` |
| Avatar (Profil) | `Math.min(Math.round(screenWidth × 0.22), 90)` |
| Bulles photo (chat) | `Math.round(screenWidth × 0.55)` |

---

## Configuration Expo / EAS

### `app.json`
- Bundle ID iOS : `com.medi_freymann.ootd`
- Package Android : `com.medi_freymann.ootd`
- EAS project ID : `4efa34fb-675c-4892-a67a-44f6d1b4d759`
- Permission Android : `POST_NOTIFICATIONS`
- iOS background modes : `remote-notification`
- Plugin expo-notifications : couleur `#ED93B1`, canal `default`

### `eas.json`
- `preview` : Android APK (test)
- `production` : Android AAB + iOS (stores)
- `appVersionSource: "remote"` (versionning géré sur expo.dev)

---

## Points d'attention pour évolution future

- **Notifications push serveur-side** : `sendPushNotification()` existe dans `lib/notifications.js` mais devrait être déclenché depuis une Edge Function Supabase à l'insert d'un message ou like (pas côté client). Les tokens push sont dans `profiles_private` — accessible via la clé service uniquement.
- **Pas de pagination Feed** : le fetch `ootds` charge tout sans `limit/offset`. À paginer quand le volume croît.
- **Messages non expirés côté client** : `expires_at` filtre côté DB mais les messages expirés pourraient rester dans le state local. Re-fetch au focus recommandé.
- **`lib/toast.js` orphelin** : event bus non utilisé. À supprimer pour éviter la confusion avec `toastContext.js`.
- **Rate-limiting edge function** : `consume_daily_credit` est la seule protection contre les abus. Ajouter un rate-limit IP/JWT dans une table `analyze_rate_limit` si le volume le justifie (SEC-16).
- **Score insert non validé** : `ootds_insert_own` n'empêche pas un client d'insérer `score_global=10`. `award_points_for_ootd` clampe à 1–10 mais le score affiché dans le feed reste celui inséré. Résoudre en déléguant l'insert à une RPC ou l'Edge Function.
- **Badge non-lu Chat** : le badge s'incrémente à chaque message reçu via Realtime mais n'a pas de persistance — il repart à 0 à chaque redémarrage de l'app.
- **`compute_niveau` dupliquée** : la logique existe en JS (`lib/utils.js`) et en PL/pgSQL (`compute_niveau()`). Toute modification du barème doit être appliquée aux deux endroits simultanément.
- **TypeScript** : `tsconfig.json` présent, `@types/*` installés. Migration progressive possible fichier par fichier.
