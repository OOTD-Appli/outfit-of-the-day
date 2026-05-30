# CLAUDE.md — Guide pour agents IA

## C'est quoi ce projet ?

**OOTD** (Outfit Of The Day) est une app mobile React Native / Expo. Les utilisateurs prennent une photo de leur tenue, une IA (Groq + Llama 4 Scout vision) l'analyse et donne des scores + conseils. Ensuite ils peuvent : publier dans un feed TikTok-style, et/ou envoyer à leurs amis via un système de "flammes" (streaks Snapchat-like). Full French UI.

**Statut actuel : code partiellement fonctionnel. Des bugs critiques bloquants (voir ci-dessous) doivent être corrigés avant que l'app tourne réellement.**

---

## Stack technique

| Couche | Techno |
|--------|--------|
| Framework | React Native 0.81.5 + Expo SDK ~54 |
| Navigation | React Navigation v7 (BottomTabNavigator, 4 onglets) |
| Backend / Auth / DB / Storage | Supabase (Postgres + RLS + Storage) |
| IA analyse tenue | Groq API — modèle `meta-llama/llama-4-scout-17b-16e-instruct` |
| Notifications push | Expo Notifications + Expo Push Service |
| Build | EAS Build (Android APK preview / AAB production) |
| Language | JavaScript (ES2022, babel via Expo) — pas de TypeScript en runtime |

---

## Bugs critiques à corriger EN PREMIER

> Ces bugs font planter l'app. Tout agent qui touche à ces fichiers doit les corriger.

### 1. `ToastProvider` non rendu dans App.js [BLOQUANT]
`App.js` importe `ToastProvider` mais ne l'utilise JAMAIS dans le JSX. Résultat : tous les appels `useToast()` lancent `"useToast must be used within a ToastProvider"`.

**Fix requis** : envelopper le retour de `App()` dans `<ToastProvider>`.

```jsx
// App.js — la branche non-authentifiée
if (!session) return <ToastProvider><AuthScreen /></ToastProvider>;

// App.js — branche authentifiée
return (
  <ToastProvider>
    <NavigationContainer>…</NavigationContainer>
  </ToastProvider>
);
```

### 2. `useToast()` retourne un objet, pas une fonction [BLOQUANT]
`useToast()` retourne `{ showToast, dismissToast, toasts }`. Tous les screens font :
```js
const showToast = useToast(); // ← objet, PAS une fonction
showToast("message");         // ← TypeError : objet n'est pas appelable
```
**Fix** : `const { showToast } = useToast();`

Fichiers affectés : `AuthScreen.js`, `FeedScreen.js`, `FlammesScreen.js`, `AccueilScreen.js`.

### 3. `useToast()` appelé dans des callbacks (violation Rules of Hooks) [BLOQUANT]
`AuthScreen.handleAuth` et `FeedScreen.onSharePress`/`toggleLike` appellent `useToast()` à l'intérieur d'une fonction asynchrone/callback → React crash.

**Fix** : déplacer `const { showToast } = useToast();` au niveau supérieur du composant (avant tout return).

### 4. `showToast` non défini dans `AccueilScreen.js` [BLOQUANT]
`AccueilScreen` importe `useToast` mais n'appelle jamais `useToast()` dans le corps du composant → `showToast` est `undefined` → ReferenceError dès le premier appel.

**Fix** : ajouter `const { showToast } = useToast();` en haut du composant.

### 5. Imports manquants dans `AccueilScreen.js` [BLOQUANT]
Ces composants sont utilisés dans le JSX mais pas importés depuis `react-native` :
- `Alert`, `TouchableOpacity`, `ActivityIndicator`, `Image`

**Fix** : les ajouter dans l'import `react-native` (lignes 10-12).

### 6. `Alert` non importé dans `FlammesScreen.js` [BLOQUANT]
`Alert.alert(...)` est utilisé ~12 fois mais `Alert` n'est pas dans les imports `react-native`.

**Fix** : ajouter `Alert` à l'import (ligne 2-6).

---

## Invariants à respecter ABSOLUMENT

- **Clé flammes** : `user1_id < user2_id` (contrainte SQL). Toujours utiliser `flammeOrderedIds(a, b)` de `lib/flammesUtils.js` pour construire les paires.
- **Snap par jour** : 1 snap max par paire et par jour (fuseau local). Vérifier avec `hasSnapUsedTodayForPair()` avant tout insert.
- **Mapping scores** : l'IA retourne `{ global, fit, harmonie, detail }`. Côté DB : `score_global=global`, `score_couleurs=harmonie`, `score_coupe=fit`, `score_tendance=detail`.
- **Clé Groq lazy** : `requireEnv('EXPO_PUBLIC_GROQ_API_KEY', ENV.groqApiKey)` est appelé UNIQUEMENT dans `analyzeOutfit()`, pas au démarrage. Si la clé manque, seule l'analyse échoue, pas le reste de l'app.
- **RLS Supabase** : chaque table a des politiques strictes. Ne jamais contourner. Tester toutes les opérations en session authentifiée.
- **Profil auto-créé** : à chaque login, `ensureUserProfile()` garantit l'existence d'une ligne dans `profiles`. Pas d'accès à `profiles` sans cette garantie.
- **Thème dark** : couleur accent `#ED93B1` (rose), fond `#0a0a0a`, `#0f0f0f`, `#121218`. Ne pas dévier.
- **Langue** : tous les textes UI en français.

---

## Structure des fichiers (vue rapide)

```
App.js                    # Auth gate + BottomTabNavigator (4 onglets)
index.js                  # registerRootComponent pour Expo
screens/
  AuthScreen.js           # Login / Signup email+password
  AccueilScreen.js        # Analyse tenue (Groq) + publication
  FeedScreen.js           # Feed TikTok (full-screen pageable, likes, commentaires)
  FlammesScreen.js        # Amis (request/accept), streaks, chat snaps
  ProfilScreen.js         # Profil, avatar, stats, galerie, déconnexion
components/
  Button.js               # Bouton réutilisable (primary/secondary/outline)
  Avatar.js               # Avatar réutilisable avec fallback initiale
  FeedCommentsModal.js    # Modal commentaires pour le feed (table comments)
lib/
  supabase.js             # Client Supabase (AsyncStorage, persistSession)
  env.js                  # Lecture EXPO_PUBLIC_* + requireEnv()
  notifications.js        # Expo Push : permission, register, savePushToken, send
  ensureProfile.js        # Crée profiles si manquant (avec retry username)
  flammesUtils.js         # flammeOrderedIds, hasSnapUsedTodayForPair, fetchAcceptedFriendIds
  toast.js                # Système toast (event bus) — NOTE: app utilise toastContext, pas ce fichier
  toastContext.js         # ToastProvider + useToast hook (React Context)
supabase/migrations/
  20260510120000_initial_schema.sql    # Schéma complet (fresh install)
  20260510121500_existing_project_align.sql  # Migrations si tables existent déjà
  20260511130000_comments.sql          # Table comments
assets/                   # logo.png, splash-icon.png, adaptive-icon.png, favicon.png
```

---

## Variables d'environnement requises

```
EXPO_PUBLIC_SUPABASE_URL=          # URL du projet Supabase
EXPO_PUBLIC_SUPABASE_ANON_KEY=     # Clé anon Supabase
EXPO_PUBLIC_GROQ_API_KEY=          # Clé API Groq (utilisée SEULEMENT pour l'analyse)
```

Fichier `.env` à la racine (non versionné). Modèle dans `.env.example`.

---

## Commandes utiles

```bash
npm start                          # Lance Expo dev server
npm run android                    # Lance sur émulateur/device Android
npm run eas:build:preview          # Build APK Android preview via EAS
npm run eas:build:prod             # Build AAB Android production via EAS
```

---

## Conventions de code

- **Pas de TypeScript en runtime** : le projet reste en JS. `tsconfig.json` est présent pour outillage/lint uniquement.
- **Pas de commentaires évidents** : commentaires réservés aux invariants non-évidents.
- **State local dans les écrans** : pas de state manager global (Redux, Zustand…). Supabase est la source de vérité.
- **useFocusEffect** pour le fetch à la navigation : tous les écrans rechargent au focus (mode `silent` pour éviter les flashs).
- **Optimistic updates** : `FeedScreen.toggleLike` applique le like localement, rollback en cas d'erreur.
- **Pas de styles globaux** : chaque écran/composant a son `StyleSheet.create` en bas de fichier.
- **`lib/toast.js` vs `lib/toastContext.js`** : `toast.js` est un event bus non-React (non utilisé dans l'app actuellement). L'app utilise `toastContext.js` (React Context). Ne pas mélanger.

---

## Ce que font les agents IA dans ce projet

Avant toute intervention :
1. Lire `TACHES.md` pour connaître l'état actuel
2. Corriger les bugs critiques listés ci-dessus si le ticket le concerne
3. Vérifier que `ToastProvider` enveloppe bien l'app avant d'ajouter des toasts
4. Chercher `Alert.alert` → vérifier que `Alert` est importé
5. Chercher `useToast` → vérifier la destructuration `const { showToast } = useToast()`
6. Mettre à jour `TACHES.md` en fin d'intervention

Voir aussi `ARCHITECTURE.md` (schéma technique) et `WORKFLOW.md` (setup + déploiement).
