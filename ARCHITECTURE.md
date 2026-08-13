# ARCHITECTURE.md — Référence technique OOTD

> Dernière mise à jour : 2026-08-09

## Vue d'ensemble

Application mobile React Native / Expo (iOS, Android, **Web/PWA**). Architecture simple : **pas de state manager global**, chaque écran gère son propre state local. Supabase est la source de vérité (DB + Auth + Storage + Realtime + Edge Functions). L'IA est appelée **exclusivement via des Edge Functions Supabase** — les clés API ne sont jamais dans le bundle client.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      App (Expo — iOS / Android / PWA)                    │
│  ┌──────┐ ┌──────┐ ┌────────┐ ┌────────┐ ┌────────┐                    │
│  │ Feed │ │ Chat │ │Analyse │ │ Profil │ │  Shop  │                    │
│  └──┬───┘ └──┬───┘ └───┬────┘ └───┬────┘ └───┬────┘                    │
│     └────────┴──────────┴──────────┴──────────┘                         │
│                  Supabase Client (lib/supabase.js)                       │
└──────────────────────────────┬────────────────────────────────────────--┘
                               │
              ┌────────────────▼──────────────────────────┐
              │               Supabase (BaaS)              │
              │  DB (Postgres + RLS)   Auth (email/pwd)    │
              │  Storage (3 buckets)   Realtime (WS)       │
              │                                            │
              │  Edge Functions                            │
              │  ├─ analyze-outfit ──────► Gemini 2.5-flash│
              │  │                  └────► Groq (fallback) │
              │  ├─ contextual-analysis ─► Gemini 2.5-flash│
              │  │                  └────► Groq (fallback) │
              │  ├─ deezer-search ────────► Deezer API     │
              │  ├─ create-checkout-session ──► Stripe     │
              │  ├─ create-payment-session ───► Stripe     │
              │  ├─ create-portal-session ────► Stripe     │
              │  ├─ stripe-webhook ◄──────────── Stripe    │
              │  └─ send-web-push ─────────► Web Push API  │
              └────────────────────────────────────────────┘
```

---

## Navigation

`App.js` implémente un **BottomTabNavigator à 5 onglets** dans `ThemedNavigator`. Le gardien d'auth est dans `App()`. `ThemeProvider` et `ToastProvider` enveloppent tout.

```
App.js
 ├── loading=true  → <ActivityIndicator>
 ├── recovery=true → <ResetPasswordScreen>            (lien de récupération cliqué)
 ├── session=null  → <ThemeProvider><ToastProvider><AuthScreen>
 └── session ok    → <ThemeProvider>
                       <ToastProvider>
                         <ThemedNavigator userId={session.user.id}>
                           ├── Accueil (🏠) → FeedScreen     (headerShown: false, plein écran)
                           ├── Chat    (💬) → FlammesScreen  ← badge non-lu (Realtime)
                           ├── Analyse (✨) → AccueilScreen
                           ├── Profil  (👤) → ProfilScreen
                           └── Shop    (🛍️) → ShopScreen
                         + <InAppBanner userId onPress>     (monté hors NavigationContainer)
```

**Header** : tous les onglets sauf Feed utilisent un header custom `<AppHeader />` (`screenOptions.header`) au lieu du header par défaut de React Navigation.

**ThemedNavigator** reçoit `userId` en prop :
- Souscrit à `supabase.channel('app-unread-msgs')` pour les INSERT sur `messages.receiver_id=userId`
- Incrémente `unreadCount` → composant `ChatTabIcon` (dot rose avec compteur "9+", pas `tabBarBadge` natif) sur l'onglet Chat
- Efface le compteur au tap de l'onglet (`listeners.tabPress`) et à l'ouverture d'une conversation via `InAppBanner`
- Tab bar glassmorphism sur web (`backgroundColor + 'E8'`, `backdropFilter: blur(20px)`), coins arrondis 28px, `animation: 'shift'`
- Couleurs depuis `useTheme()` (accent, fond, bordure)

**InAppBanner** (montée au niveau racine, au-dessus des tabs) : bannière qui descend en haut de l'écran quand un nouveau message Realtime arrive sur une conversation qui n'est pas déjà ouverte (`lib/activeChat.getActiveChat()`). Tap → `openConversation(friendId)` navigue vers Chat et remet `unreadCount` à 0.

**Auth flow** : `App.useEffect` appelle `supabase.auth.getSession()`, puis écoute `onAuthStateChange`. `syncSession()` enchaîne `ensureUserProfile()`, enregistrement push (natif) et `registerWebPush()` (PWA). Sur web, les tokens de récupération de mot de passe sont parsés manuellement depuis le hash **et** la query string (`parseAuthParams`) pour fiabiliser Safari iOS/PWA, avec pose de session explicite (`setSession`/`verifyOtp`/`exchangeCodeForSession`).

**Deep links messagerie** (`?chat=<id>`) : gérés dans 3 cas — app fermée (lu depuis `INITIAL_HREF` au montage), app ouverte (message `postMessage` du service worker), et clic sur notification native (`Notifications.addNotificationResponseReceivedListener`, route aussi vers l'onglet Analyse si l'URL contient "analyse" — rappel flamme quotidien).

---

## Thème et cosmétiques

### `lib/themeContext.js` — `ThemeProvider` + `useTheme()`

**Deux dimensions indépendantes** : 5 palettes cosmétiques (`default` rose, `midnight` bleu nuit, `emerald` vert, `gold` or, `sakura` rose poudré) **× 2 modes de couleur** (`dark` / `light`) = `DARK_PALETTES` et `LIGHT_PALETTES`, chacun exposant les mêmes 8 clés : `accent`, `bg`, `card`, `border`, `textPri`, `textSub`, `tabBar`, `tabBorder`.

- `useTheme()` retourne `{ theme, colorMode, setColorMode, refreshTheme, activeLogo }` — **toujours destructurer**.
- `resolvePalette(themeName, mode)` sélectionne le pool puis le thème dedans (fallback `default` si nom inconnu).
- **Initialisation** (`getInitialColorMode()`) : lecture **synchrone** de `localStorage['ootd_color_mode']` sur web (anti-flash) ; sinon `Appearance.getColorScheme()` (suit le thème système tant que l'utilisateur n'a jamais choisi explicitement).
- **Persistance locale** : `localStorage` (web) ou `AsyncStorage` (natif), clé `ootd_color_mode`.
- **Sync cross-device** : `setColorMode()` écrit aussi `supabase.auth.updateUser({ data: { dark_mode: bool } })` (dans `user_metadata`, **pas** une colonne `profiles`). `refreshTheme()` (appelé à chaque `onAuthStateChange`) donne priorité à `user_metadata.dark_mode` s'il existe, et réécrit le stockage local en conséquence.
- **Suivi système** : `Appearance.addChangeListener` bascule automatiquement `colorMode` si rien n'a jamais été choisi localement.
- `activeTheme` (nom de palette cosmétique) est chargé depuis `profiles.active_theme` au changement de session ; `refreshTheme()` exporté pour `ShopScreen` (ré-applique après équipement).
- Toggle UI : `ProfilScreen` → modal Paramètres → section "Apparence" (switch lune/soleil animé `Animated.spring`).

### `lib/logoConfig.js` — `getLogoConfig(logoId)`

**10 logos** au total, deux familles :
- **5 logos emoji** (badge/cadre) : `default` (⭐), `diamond` (💎, bleu), `crown` (👑, or), `fire` (🔥, orange), `star` (🌟, jaune) — exposent `emoji`, `frameBorderColor`, `postIcon`, `badge`.
- **5 logos image** (`assets/logos/*.jpg`) : `bleu_neon`, `sunset`, `vert_neon`, `rose_flashy`, `rose_pastel` — exposent `frameBorderColor` + un champ `image` (`require(...)`), pas de `badge`/`postIcon`.

`getLogoConfig()` retourne la config correspondante ou `default` si `logoId` est inconnu. Consommé par `AppHeader` (logo dans le header, fallback `assets/logo.jpg` si pas de champ `image`), `Avatar`, `FeedScreen`, `FlammesScreen`, `ProfilScreen`.

> Le logo par défaut attribué aux nouveaux profils est `star` (migration `20260603140000`).

---

## Écrans — détail fonctionnel

### AuthScreen (`screens/AuthScreen.js`)
- **Mode login** : `signInWithPassword` → `ensureUserProfile()` en fallback
- **Mode inscription** : `signUp` avec `options.data.username` → insert dans `profiles`
- Bascule login/signup via `isLogin` state
- Modal "Mot de passe oublié" : `resetPasswordForEmail()` → email de récupération
- Logo responsive : `Math.min(Math.round(screenHeight * 0.17), 140)`
- Feedback : `const { showToast } = useToast()`

### ResetPasswordScreen (`screens/ResetPasswordScreen.js`)
- Affiché quand un lien de récupération est cliqué (deeplink `type=recovery` ou `/reset-password`)
- `supabase.auth.updateUser({ password })` → signOut → retour AuthScreen
- Validations : longueur min 6, confirmation match

### AccueilScreen (`screens/AccueilScreen.js`)
Reçoit `{ navigation }` de React Navigation (navigue vers Shop).

**Phase 1 — Sélection image**
- `openImageSourcePicker()` : Alert.alert avec choix caméra/galerie
- **Caméra** : ouvre désormais `<InAppCamera mode="photo">` (composant custom plein écran, `expo-camera`) au lieu du picker caméra système — **Galerie** : reste `expo-image-picker`
- Compression systématique via `expo-image-manipulator` : max 1280px, JPEG 0.78 pour l'IA, WebP 0.72 pour le stockage (fallback JPEG sur web)
- Cooldown anti-double-analyse : 5 min sur la même image (`lastAnalyzedRef`)

**Phase 2 — Crédits**
- Tier Elite (Stripe) → illimité
- Tier Plus/pass → 20/jour
- Gratuit → 2/jour
- Si `credits === 0` : carte `noCreditsCard` + bouton "Obtenir plus" → Shop
- **Le crédit quotidien est partagé** entre l'analyse principale et l'analyse contextuelle (même RPC `consume_daily_credit`)
- Tier résolu via `lib/tier.resolveTier()` (`userTier` state) — partagé avec ProfilScreen/ShopScreen

**Rappels de monétisation** (Cahier des charges 2026-08-12, cartes réutilisant le style `noCreditsCard` — le composant toast de l'app n'a pas de CTA cliquable, insuffisant pour ces rappels) :
| Rappel | Condition | Fréquence | Stockage throttle |
|---|---|---|---|
| Dernière analyse du jour | `userTier==='free' && credits===1` | 1×/jour | `AsyncStorage['@ootd_reminder_lastcredit_date']` |
| Note ≥ 8/10 | Résultat `global >= 8` et `userTier !== 'elite'` | 1× / 3 jours | `AsyncStorage['@ootd_reminder_highscore_ts']` |

Throttle en `AsyncStorage` (pas en DB) : purement un état d'affichage local, pas une donnée métier à synchroniser entre appareils.

**Phase 3 — Analyse IA principale**
- `supabase.functions.invoke("analyze-outfit", { body: { base64Image, personality } })`
- `base64Image` = `data:image/{jpeg|png|webp};base64,{raw}` (préfixe MIME obligatoire)
- `personality` = clé fermée lue depuis `profiles.analysis_personality` (voir « Personnalité du critique IA » ci-dessous), fallback `'coach'`
- Rate-limit : 5 requêtes/minute (`check_analyze_rate_limit` RPC, avant consommation crédit)
- Timeout : 25 secondes via `withTimeout()`
- Résultats : 3 jauges arc (Fit, Harmonie, Détails) via `components/Gauge.js` (react-native-svg), 1-2 hashtags de style
- Animations : fade + rise + scale (AnimatedEntrance)

**Phase 3bis — Conseil contextuel (optionnel)**
- Bloc "Conseil contextuel" (toggle `showContextPanel`) : `TextInput` `contextText` (120 car. max, ex. "entretien d'embauche", "mariage champêtre") + bouton "Analyser le contexte"
- `analyzeContext()` → `supabase.functions.invoke("contextual-analysis", { body: { base64Image, context } })` sur la **même photo déjà sélectionnée**, en plus de l'analyse principale (action utilisateur distincte, pas chaînée automatiquement)
- Résultat : badge coloré (vert si cohérent, orange sinon) + `pourquoi` + `conseil` + `alternative` optionnelle

**Phase 4 — Personnalisation (CustomizationScreen modal)**
- Ajout caption (200 chars max)
- Sélection musique Deezer (proxy Edge Function → 10 résultats, autoplay preview 30s MP3 à la sélection)
- Toggle "afficher mes hashtags de style" (si `score.styles.length > 0`) → `ootds.show_style_hashtag`
- Choix des notes visibles publiquement → `ootds.visible_scores`

**Phase 5 — Publication**
- `publishToFeed()` : upload Storage → insert `ootds` (avec `styles`, `show_style_hashtag`, `visible_scores`) → **RPC `award_points_for_ootd(ootd_id)`** → si styles présents, RPC `increment_style_stats(styles)` (stats de profil)
- **Sélecteur d'amis** (`flammesPicker`/`openFlammesPicker`) : `sendOutfitToSelectedFlammes()` envoie à une **sélection multiple** d'amis choisis (plus un envoi automatique "à tous") → upload mutualisé → insert `snaps`/`messages` (avec scores + conseil) par ami sélectionné (skip si quota jour atteint) → update/insert `flammes.streak`
- `saveForSelf()` : insert `ootds` avec `is_public=false`, pas de points

**Stories** (voir aussi FlammesScreen)
- Section "Ma story" dans l'onglet Analyse : aperçu de la story active, ou bouton "Publier une story" → `<InAppCamera mode="video">` → modal de preview (overlay_text + caption) → `publishStory()`

**Mapping scores IA → DB :**
```
IA:  global         fit           harmonie        detail          styles
DB:  score_global   score_coupe   score_couleurs  score_tendance  styles (text[])
```

### FeedScreen (`screens/FeedScreen.js`)
- **UX TikTok** : `FlatList` `pagingEnabled`, `snapToInterval=pageH`, `decelerationRate="fast"`, chaque item = plein écran
- **Fetch** : `ootds` joint `profiles(username, avatar_url, active_logo, is_private)`, `likes(id, user_id)`, `comments(count)` + colonnes `styles, show_style_hashtag, visible_scores` — pagination 10/page, chargement infini (`onEndReached`)
- **Confidentialité** : posts `is_private` filtrés côté DB sauf auteur ou ami accepté
- **Recherche** : bouton loupe → overlay `TextInput` `searchQuery` ("Hashtag, description, @utilisateur...") — filtrage **côté client** (`useMemo`) sur `username`, `caption`, `styles[]`, appliqué aux posts déjà chargés
- **Toggle "œil" notes** (`showNotes`, icône `eye`/`eye-off`) : bascule l'affichage de toutes les notes en plus des `visible_scores` choisies par l'auteur à la publication
- **Hashtags de style** : affichés sous la caption si `item.show_style_hashtag && item.styles.length`
- **Flux "Pour toi" spécialisé** : si `profiles.specialized_feed` actif, interleave ~70/30% posts matchant le top 3 de `profiles.style_stats` (`userTopStyles`) vs contenu global — actif uniquement onglet "POUR TOI" sans recherche en cours
- **Musique** : auto-play preview Deezer 30s à 80% de visibilité (`onViewableItemsChanged`), mute global (bouton top-right), cleanup complet `Audio.Sound` au blur de l'onglet
- **Double-tap** : like animé (composant `HeartOverlay`, `ref.play()`) + haptic feedback
- **Like optimiste** : update local immédiat → DB → rollback en cas d'erreur
- **Partage** : modale sélection ami → insert `messages` (RLS exige amitié acceptée)
- **Commentaires** : délégués à `FeedCommentsModal`
- **Logo** : `getLogoConfig(item.profiles.active_logo)` → cadre avatar coloré, badge pseudo, icône overlay
- **Skeleton** : composant `components/Skeleton.js` (placeholder shimmer) pendant le chargement

### FlammesScreen (`screens/FlammesScreen.js`)
3 vues gérées par le state `view` : `'list'` | `'chat'`

**Vue list (défaut)**
- Liste amis acceptés avec streak 🔥, logos sur tous les avatars
- Cercles stories en haut (viewer vidéo/photo modal plein écran) ; publication via `<InAppCamera mode="video">` (`postStory()` → preview → `publishStory()`)
- Section "Demandes" si demandes entrantes
- Recherche pseudo normalisée (accents/emoji/casse, 3 patterns combinés, dès 2 chars) — actions contextuelles selon état relation

**Vue chat**
- Header : avatar (cadre logo), pseudo (badge logo), streak
- Messages bulles gauche/droite selon `sender_id`, **largeur fixe à 50%** de la largeur utile — `styles.msgRow` a `width: '50%'` (pas `maxWidth`, pour que même un message très court occupe la même largeur, cf. demande produit), `swipeableBubbleWrap`/`bubble` en `width: '100%'` de leur parent pour remplir exactement cette colonne. *(Historique : d'abord un `maxWidth` en % (78% puis 50% puis 100%) combiné à une taille d'image calculée en pixels depuis `ww` — approche fragile qui a produit deux régressions de débordement avant cette réécriture en tailles 100% relatives.)*
- **Saisie** : `onChangeMessageText` détecte un `\n` en fin de texte (touche Entrée) et appelle `sendTextMessage()` au lieu de l'insérer — pas besoin de taper sur le bouton d'envoi. Le `TextInput` reste contrôlé (`value={messageText}`), donc le saut de ligne ne s'affiche jamais.
- Photo : `<InAppCamera mode="photo">` sur natif (au lieu du picker système) → upload `ootds/messages/<uid>/<ts>.jpg` → insert `messages` → update `flammes.streak`. **Sur web**, `pickChatPhotoWeb()` ouvre directement l'appareil photo via `<input type=file capture="environment">` (même technique que `AccueilScreen.pickImageWeb`) plutôt que la galerie.
- **Photo dans la bulle** : `styles.msgImage` est `{ width: '100%', aspectRatio: 1 }` — 100% relatif à la bulle elle-même (donc toujours exactement encadrée, quelle que soit la largeur d'écran), plus de calcul de taille en pixels absolus depuis `ww`.
- **Messages vocaux** : bouton micro dans la barre de saisie.
  - `startRecording()` : `Audio.Recording.createAsync(HIGH_QUALITY)`, timer `recordingDuration`
  - `stopAndSendRecording()` : annule si < 1s ; sinon upload Storage `ootds/audio/<uid>/<ts>.<ext>` (`webm` web / `m4a` natif) → insert `messages.audio_url`, affichage optimiste immédiat
  - `playAudioMsg()` : lecture/pause via `Audio.Sound`, un seul son actif à la fois
  - Composant `AudioMessage` : bulle avec cercle play/pause + waveform 12 barres animées + durée `mm:ss`
- **Partage de profil** : `sendProfileShare()` insère un message JSON `{ _type: 'profile', ... }` → tap → modal profil (`profileModal`/`openUserProfile`)
- **Typing indicator** : channel broadcast `typing-{pairKey}`, throttle 1.5s, timeout 4s, 3 points rebondissants
- **Likes messages** : double-tap message reçu → `toggle_message_like` RPC → badge ❤️ (optimistic)
- **Suppression** : appui long message envoyé → `delete_message` RPC (soft delete + nettoyage Storage)
- **Accusés de lecture** : `read_at` mis à jour par `mark_messages_read` RPC, coches WhatsApp-style (gris = livré, accent = lu)
- **Swipe-to-reply** : `SwipeableMessageBubble` (`PanResponder`, swipe droite ≥48px + haptic) → barre de reply au-dessus du `TextInput` → `reply_to_id` sur l'insert → quote affichée dans la bulle
- **Cards profil / scores** : messages/snaps portent aussi `score_global/couleurs/coupe/tendance` + `conseil` quand une tenue analysée est partagée — affichage en badges sous l'image si le toggle "œil" (`showNotes`) est actif
- **Notifications** : `dismissChatNotifications(friendId)` à l'ouverture d'une conversation (ferme les notifs SW/natives déjà affichées pour ce fil)

**Flammes — 3 états (calculés côté client depuis `last_snap_at`)**
| État | Condition | Affichage |
|------|-----------|-----------|
| Active 🔥 | ≤ 24h depuis dernier snap | streak coloré |
| Expirée 🩶 | 24–72h (restaurable) | grisée + bouton ranimer |
| Morte | > 72h | streak = 0 |

- **Restauration** : `restore_flamme(flamme_id)` RPC (fenêtre 48h, consomme 1 gel)
- Si 0 gel → redirection Shop

**Streak flammes** : comparaison par jours calendaires ISO (`daysDiff = Math.round(...)`) — si ≤ 1 : incrément, sinon reset à 1.

**Realtime channels actifs (FlammesScreen)**
| Canal | Type | Événement |
|-------|------|-----------|
| `list-msgs-{userId}` | postgres_changes | INSERT messages receiver_id=moi |
| `chat-{userId}-{friendId}` | postgres_changes | INSERT/UPDATE/DELETE messages |
| `typing-{pairKey}` | broadcast | typing indicator |

> `InAppCamera` est partagée avec `AccueilScreen` (même composant, props `mode`/`onCapture`/`onClose`).

### ProfilScreen (`screens/ProfilScreen.js`)
- Fetch `profiles.*` + `subscriptions.*` + `ootds.*` au focus
- Avatar upload : `fetch(uri).blob()` → `avatars/<uid>/avatar.jpg` (cache-buster `?t=<ts>`)
- Stats : nb tenues, score moyen, points, badge abonnement (💎 Elite / ⭐ Plus)
- **Niveau** : `computeLevelInfo(pts)` → `{ threshold, progressInLevel, percent }` — formule exponentielle ×1.8
- **Top styles** : chips calculées depuis `profiles.style_stats` (top 3 triés par compteur) affichées sous les stats
- Galerie 3 colonnes avec pagination (21/page), lightbox horizontal swipe enrichie : badge note globale + date, 3 badges colorés (Fit/Harmonie/Détails), chips de style, section Description (`caption`), section Conseils IA structurée (points forts / à améliorer)
- **Téléchargement d'image** : bouton (avec spinner) dans la lightbox → `lib/downloadImage.downloadImageToDevice()`
- **Suppression de tenue** : `doDeleteOotd()`/`deleteOotd()` — nettoyage Storage inclus
- Modal paramètres : username, bio (160 chars), is_private toggle, **toggle "contenu spécialisé"** (`profiles.specialized_feed`), **toggle apparence dark/light** (`colorMode`), **sélecteur "Personnalité du critique IA"** (5 options, `profiles.analysis_personality`, constante client `PERSONALITIES` — labels/emoji uniquement, le texte de ton réel reste côté serveur) : options hors du tier de l'utilisateur affichées grisées avec 🔒 + tier requis (`lib/tier.isPersonaUnlocked`), tap → `navigation.navigate('Shop')` au lieu de sélectionner, email (RO), déconnexion
- **Historique de la galerie** (perk Plus/Elite) : tier Gratuit plafonné à la 1ère page (21 tenues les plus récentes) — `ootdsHasMoreRef` forcé à `false` dès `fetchProfil` pour ce tier, pas d'appel réseau `loadMoreOotds` inutile. Bannière `🔒 Débloque l'historique complet...` en fin de liste (`showHistoryLock`), tap → Shop. Plus/Elite : pagination infinie normale.
- **PWA** : bouton "Télécharger l'app" si `!isPwaStandalone()` et web (`lib/pwa.web.js`)

### ShopScreen (`screens/ShopScreen.js`)
3 sections distinctes :

**1. Premium (Stripe — abonnements récurrents)**
| Plan | Prix | Avantages |
|------|------|-----------|
| OOTD Plus | 2,99€/mois | 20 analyses/jour, badge ⭐, historique complet, personnalité "Styliste bienveillant" |
| OOTD Elite | 4,99€/mois | Analyses illimitées, tous cosmétiques, badge 💎, toutes les personnalités IA |

Détection de tier via `lib/tier.js` (`getSubActive`/`getActivePlan`, partagé avec ProfilScreen/AccueilScreen — ne pas dupliquer `['active','trialing'].includes(status)` localement).

- Bouton → `create-checkout-session` Edge Function → `Linking.openURL(url)`
- Gérer / résilier → `create-portal-session` → Customer Portal Stripe
- Retour deep link : `ootd://shop`

**2. Achats Express (Stripe — one-time, 0,99€)**
- Gel de Flamme → `create-payment-session` (product='flame_freeze')
- Pack 2 000 points → `create-payment-session` (product='points_2000')
- Crédit posé par webhook `stripe-webhook`, jamais ici

**3. Boutique Points**
- Thèmes : Midnight/Émeraude `1 000 pts`, Or Prestige/Sakura `1 500 pts`
- Icônes (badges emoji) : Flamme `150 pts`, Diamond/Étoile Pro/Couronne `200 pts`
- **Logos App** (nouvelle sous-catégorie, images réelles `assets/logos/*.jpg`) : Bleu Néon `500 pts`, Vert Néon `500 pts`, Sunset `600 pts`, Rose Flashy `650 pts`, Rose Pastel `750 pts` — partagent le même `item_type:'logo'`/colonnes `unlocked_logos`/`active_logo` que les icônes emoji ; équiper un logo-image met aussi à jour le favicon web
- Flux : `buy_cosmetic` RPC → `equip_cosmetic` RPC → `refreshTheme()`
- Elite : tout gratuit (Équiper direct)
- **Points insuffisants** : bouton "Acheter" visuellement grisé mais jamais `disabled` — le tap reste actif et affiche un toast `Il te manque N pts pour débloquer « X »` au lieu de bloquer silencieusement l'interaction.

**Gels mensuels** : `claim_monthly_freezes()` RPC (Free=1, Elite=2, idempotente par mois). Compteur ❄️ en haut du Shop.

### CustomizationScreen (`screens/CustomizationScreen.js`)
Modal plein écran post-analyse, appelé depuis AccueilScreen. Props : `visible`, `onClose`, `theme`, `score`, `imageUri`, `caption`, `setCaption`, `selectedMusic`, `setSelectedMusic`, `onPublish`, `onFlammes`, `onSaveForSelf`.
- Résumé scores (chips global / fit / harmonie / détails)
- TextInput caption (200 chars max)
- Recherche musique Deezer inline (proxy Edge Function) : tap sur un résultat → **autoplay immédiat** de l'extrait (`loadAndPlayPreview` + `selectTrack` dans le même `onPress`), bouton play/pause sur la puce sélectionnée (`togglePreviewPlayback`), cleanup (`stopPreview`) au démontage/avant chaque action
- Toggle "afficher mes hashtags de style" (si tags disponibles) → `show_style_hashtag`
- Sélection des notes visibles publiquement → `visible_scores`
- 3 boutons d'action (feed / flammes / privé)

---

## Composants réutilisables

### `AppHeader` (`components/AppHeader.js`)
Header custom de l'app (remplace le header par défaut de React Navigation). Props : `{ title }` (défaut `'OOTD'`). Affiche le logo actif équipé (`getLogoConfig(activeLogo).image`, fallback `assets/logo.jpg`) via `useTheme()`.

### `Bouncy` / `Bouncy.web.js` (`components/Bouncy.js`)
Wrapper de pression tactile réutilisable (remplace `TouchableOpacity`) avec effet d'enfoncement élastique au press. Props : `onPress`, `onLongPress`, `disabled`, `style`, `children`, `scaleTo` (défaut 0.93), `hitSlop`, `accessibilityLabel`. Variante native (`react-native-reanimated`, thread UI) et variante web (`Animated` classique RN, plus stable sur react-native-web). Utilisé de façon transverse dans tous les écrans.

### `HeartOverlay` / `HeartOverlay.web.js` (`components/HeartOverlay.js`)
Cœur overlay animé sur double-tap (Feed). API impérative via `forwardRef` + `useImperativeHandle` : `ref.play()` déclenche scale spring + légère rotation + fade-out (~280ms). Pas de props d'entrée. Variante native (Reanimated) / web (`Animated`).

### `InAppBanner` (`components/InAppBanner.js`)
Bannière flottante de notification in-app (nouveau message reçu hors de la conversation ouverte). Props : `{ userId, onPress(senderId) }`. S'abonne au channel Realtime `inapp-banner` (INSERT `messages` filtré `receiver_id`), ignore ses propres messages et ceux de la conversation déjà ouverte (`lib/activeChat.getActiveChat()`). Auto-dismiss ~3.2s. Montée une fois au niveau racine (`App.js`), au-dessus des tabs.

### `InAppCamera` (`components/InAppCamera.js`)
Modale caméra plein écran custom basée sur `expo-camera` (`CameraView`, `useCameraPermissions`, import protégé try/catch). Props : `visible`, `mode` (`'photo'|'video'`), `onCapture(asset)`, `onClose`. Gère bascule caméra avant/arrière, écran de permission dédié, capture photo (`takePictureAsync`) ou enregistrement vidéo (`recordAsync`, indicateur REC). Remplace le picker caméra système sur natif pour : photo de tenue et story vidéo (`AccueilScreen`), photo de chat et story vidéo (`FlammesScreen`). La galerie reste `expo-image-picker`.

### `Skeleton` (`components/Skeleton.js`)
Placeholder de chargement générique (shimmer, boucle opacity 0.35↔0.7). Props : `width`, `height`, `borderRadius` (défaut 8), `style`, `color`. Utilisé dans `FeedScreen` et `ProfilScreen`.

### `Button` (`components/Button.js`)
Props : `title`, `variant` (primary/secondary/outline), `loading`, `disabled`, `leftIcon`, `rightIcon`, `onPress`

### `Avatar` (`components/Avatar.js`)
Props : `uri`, `size` (défaut 80), `username` (initiale fallback), `loading`, `onPress`, `borderWidth`, `borderColor`
- State `hasError` + `onError` → fallback initiale colorée

### `FeedCommentsModal` (`components/FeedCommentsModal.js`)
Props : `visible`, `ootdId`, `userId`, `onClose`, `onThreadCount(ootdId, count)`
- Modal `presentationStyle="pageSheet"`, toutes couleurs via `useTheme()`
- Load `comments` joint `profiles(username, avatar_url)`
- Suppression long-press (uniquement ses propres commentaires)
- `timeAgo` importé depuis `lib/utils`

### Composants inline (dans les écrans)
- **Gauge** : arc SVG partiel coloré (react-native-svg) — 3 critères Analyse
- **AnimatedEntrance** : fade + rise + scale à l'apparition
- **AudioMessage** (FlammesScreen) : bulle message vocal (waveform + play/pause + durée)
- **TypingDots** : 3 points rebondissants pour indicateur typing Chat
- **LikeBadge** : animation élastique du badge ❤️ sur like message
- **DarkLightToggle** (ProfilScreen) : switch animé lune/soleil pour le mode dark/light
- **SwipeableMessageBubble** (FlammesScreen) : bulle avec swipe-to-reply (`PanResponder`)

---

## Bibliothèques partagées (`lib/`)

### `lib/tier.js` — détection de tier (Gratuit/Plus/Elite), partagée
- `getSubActive(subscription)` / `getActivePlan(subscription)` : dédoublonne `['active','trialing'].includes(status)`, dupliqué historiquement dans ShopScreen/ProfilScreen/AccueilScreen
- `resolveTier({ subscription, hasPlus, hasAnalysis })` → `'free'|'plus'|'elite'` (passes legacy `has_ootd_plus_pass`/`has_analysis_pass` = équivalent Plus, jamais Elite — nuance différente de `isThemeOwned`/`isLogoOwned` dans ShopScreen qui traitent `hasPlus` comme Elite pour les cosmétiques, gardée locale à cet écran)
- `PERSONA_TIER`, `DEFAULT_PERSONA` ('coach'), `isPersonaUnlocked(key, tier)`, `tierLabel(tier)` — **DOIT rester synchronisé** avec la copie TS dans `supabase/functions/analyze-outfit/index.ts` (pas de module partagé entre l'app Expo et les Edge Functions Deno)

### `lib/supabase.js`
Client unique exporté comme `supabase`. `AsyncStorage` pour persister la session. `detectSessionInUrl` conditionné à `Platform.OS === 'web'` pour parser les deep links web (récupération password).

### `lib/utils.js`
- `computeNiveau(pts)` → niveau entier (formule exponentielle ×1.8)
- `computeLevelInfo(pts)` → `{ threshold, progressInLevel, percent }` pour la barre de progression
- `timeAgo(date)` → chaîne relative en français ("à l'instant", "5 min", "2 h", "3 j")

> La logique `computeNiveau` est répliquée côté serveur en PL/pgSQL (`compute_niveau(p_pts)`). **Toute modification du barème doit être appliquée aux deux endroits simultanément.**

### `lib/themeContext.js` / `lib/logoConfig.js`
Voir section « Thème et cosmétiques » ci-dessus.

### `lib/downloadImage.js` — `downloadImageToDevice(imageUrl, fileBaseName = 'ootd_outfit')`
Télécharge une image distante vers l'appareil. Retourne `{ ok, reason? }` (`reason: 'permission' | 'error'`). Web : `fetch` + `Blob` + lien `<a download>` synthétique. Natif : `expo-media-library` (permission galerie) + `expo-file-system/legacy` (`downloadAsync` puis nettoyage temp). Utilisé dans `ProfilScreen` (lightbox galerie).

### `lib/env.js`
Lit `process.env.EXPO_PUBLIC_*`. `requireEnv(name, value)` lève une erreur si `value` est falsy. Les clés Gemini/Groq et VAPID privée ne sont PAS ici — secrets Supabase côté serveur uniquement.

### `lib/ensureProfile.js` — `ensureUserProfile()`
1. `getUser()` → si non authentifié, retourne `{ok:true, skipped:true}`
2. SELECT depuis `profiles` — si absent : INSERT avec username depuis `user_metadata`, `active_logo: 'star'`
3. Retry sur conflit 23505 : `<base>_<uid8>` puis `user_<uid8>`

### `lib/flammesUtils.js`
- `flammeOrderedIds(a, b)` → `{user1_id, user2_id}` avec user1 < user2 (**invariant SQL**)
- `getLocalDayIsoRange()` → fenêtre minuit-minuit fuseau local
- `fetchAcceptedFriendIds(supabase, userId)` → liste dédupliquée amis acceptés (UNION les deux sens)
- `hasSnapUsedTodayForPair(supabase, senderId, receiverId)` → `count >= 1`

### `lib/notifications.js`
- `registerForPushNotifications()` : permission → canal Android → token Expo Push (skip web + Expo Go)
- `savePushToken(token)` : **`UPSERT profiles_private(id, push_token)`** — jamais dans `profiles`
- `scheduleFlammeReminder(hour, minute)` : notif locale quotidienne (19h par défaut) — natif uniquement
- `sendPushNotification(token, title, body)` : Expo Push API (à appeler depuis Edge Function)

### `lib/toastContext.js` — `ToastProvider` + `useToast()`
- `useToast()` retourne `{ showToast, dismissToast, toasts }` — **toujours destructurer**
- Types : `info` (noir), `success` (vert), `warning` (jaune), `error` (rouge)
- Auto-dismiss après `duration` ms (défaut 3000)

> `lib/toast.js` est un event bus alternatif non-React, confirmé **non importé nulle part** dans le code actuel. À supprimer.

### `lib/haptics.js`
- `triggerHaptic(duration)` : vibration via `Vibration` (natif) ou `navigator.vibrate` (PWA)

### `lib/pwa.js` (natif — stub no-op) / `lib/pwa.web.js` (implémentation réelle)
La logique PWA réelle vit désormais dans `pwa.web.js` (le fichier `pwa.js` importé sur natif ne fait rien) :
- `setupPwa()` : injection manifest + apple-touch-icon + meta theme-color + enregistrement service worker `/sw.js`, écoute `beforeinstallprompt`/`appinstalled`, bannière DOM custom d'installation (Chrome/Edge/Android) ou astuce iOS Safari (Partager → écran d'accueil)
- `isPwaStandalone()` : détecte `display: standalone`
- `canInstallPwa()` / `promptInstall()` : gèrent `deferredPrompt`
- `requestWebNotificationPermission()`
> Les fonctions `registerWebPush`, `dismissChatNotifications` et `sendMessageToSW` ne vivent plus ici — voir `lib/webPush.js` (et `sendMessageToSW` a disparu du code, ne plus la référencer).

### `lib/webPush.js` (natif — stub no-op) / `lib/webPush.web.js` (implémentation réelle)
- `registerWebPush()` : vérifie le support navigateur, demande permission, `pushManager.subscribe()` avec `applicationServerKey` dérivée de `EXPO_PUBLIC_VAPID_PUBLIC_KEY`, upsert dans `web_push_subscriptions` (onConflict `endpoint`)
- `unsubscribeWebPush()` : désabonne + delete DB
- `dismissChatNotifications(friendId)` : ferme les notifications SW taguées `chat-<friendId>` à l'ouverture d'une conversation

### `lib/activeChat.js`
- `setActiveChat(friendId)` / `getActiveChat()` via `localStorage` — indique au service worker et à `InAppBanner` quelle conversation est ouverte (évite les notifications en doublon)

---

## Edge Functions Supabase

### `analyze-outfit`
| Clé | Valeur |
|-----|--------|
| Méthode | POST |
| Auth | JWT obligatoire |
| Rate-limit | 5 req/min (`check_analyze_rate_limit` RPC avant consommation crédit) |
| Entrée | `{ base64Image: "data:image/jpeg;base64,...", personality?: "fashion_week"\|"bienveillant"\|"pote_hype"\|"coach"\|"streetwear" }` (image max ~7,5 Mo, JPEG/PNG/WebP) |
| Sortie | `{ global, fit, harmonie, detail, explications: {fit, harmonie, detail}, conseil, styles: string[] (1-2 tags, whitelist fermée de 20), credits_remaining, max_credits, provider }` |

**Providers** (avec fallback automatique) :
1. Google Gemini 2.5-flash (THINKING_BUDGET=0, max 1500 tokens, `responseMimeType: 'application/json'`)
2. Groq Llama 4 Scout 17B vision (fallback si Gemini KO)

Note globale calculée côté serveur (moyenne clampée 0–10), pas par l'IA. `styles` filtré contre une whitelist fixe côté serveur avant retour/stockage.

**Personnalité du critique IA** (`personality`) : clé fermée uniquement — le client n'envoie jamais de texte libre, seulement une des 5 clés ci-dessus (mappées à un texte de ton côté serveur dans `PERSONALITIES`, non exposé au client). Clé invalide/absente → fallback `coach`. **N'affecte que le ton** des textes générés (`*_analyse`, `points_forts`, `axes_amelioration`) — le barème de notation (Critères 1-3) est appliqué à l'identique quelle que soit la personnalité, pour que les notes/points restent comparables entre utilisateurs. Choisie par l'utilisateur dans `ProfilScreen` → Paramètres → « Personnalité du critique IA », persistée dans `profiles.analysis_personality` (migration `20260811120000`).

**Gating par tier** (Cahier des charges Monétisation, migration `20260812120000`) — vérifié côté serveur, jamais sur la seule foi du client :
| Personnalité | Tier requis |
|---|---|
| `coach` (Coach mode motivant) | Gratuit |
| `bienveillant` (Styliste bienveillant) | Plus |
| `pote_hype`, `fashion_week`, `streetwear` | Elite |

La fonction reçoit `personality`, résout le tier réel de l'utilisateur (`profiles.has_ootd_plus_pass/has_analysis_pass` + `subscriptions.status/plan_type`, via une résolution dupliquée en TS — DOIT rester synchronisée avec `lib/tier.js`), et retombe sur `coach` si la clé demandée dépasse le tier réel. `coach` est le seul choix garanti accessible à tous — c'est le défaut de la colonne (`DEFAULT 'coach'`) depuis cette migration.

**Secrets** : `GEMINI_API_KEY`, `GROQ_API_KEY`, `APP_ORIGIN`

### `contextual-analysis`
| Clé | Valeur |
|-----|--------|
| Méthode | POST |
| Auth | JWT obligatoire |
| Rate-limit | 5 req/min (même RPC `check_analyze_rate_limit` qu'`analyze-outfit`) |
| Crédit | Consomme le **même** crédit quotidien qu'`analyze-outfit` (`consume_daily_credit`) |
| Entrée | `{ base64Image: "data:image/jpeg;base64,...", context: "entretien d'embauche" }` |
| Sortie | `{ coherent: boolean, badge, verdict: "Oui"|"Non", pourquoi, conseil, alternative, credits_remaining }` |

Action utilisateur **distincte et optionnelle** (bouton "Analyser le contexte" dans `AccueilScreen`, après l'analyse principale) — juge si la tenue déjà photographiée/analysée est adaptée à une situation décrite en texte libre. Prompt "Styliste/Personal Shopper" (pas de notation par critère).

**Providers** : Gemini 2.5-flash en priorité, fallback Groq Llama 4 Scout — même mécanisme qu'`analyze-outfit`.

**Secrets** : `GEMINI_API_KEY`, `GROQ_API_KEY`, `APP_ORIGIN`

### `deezer-search`
| Clé | Valeur |
|-----|--------|
| Méthode | POST |
| Auth | Optionnelle (`--no-verify-jwt`) |
| Entrée | `{ q: "query" }` (min 2 chars) |
| Sortie | `{ results: [{id, title, artist, previewUrl, coverUrl}] }` (max 10, preview obligatoire) |

Proxy CORS-safe vers `api.deezer.com/search`. **Secrets** : `APP_ORIGIN`

### `create-checkout-session`
| Clé | Valeur |
|-----|--------|
| Méthode | POST |
| Auth | JWT obligatoire |
| Entrée | `{ plan_type: 'plus'|'elite' }` |
| Sortie | `{ url: "https://checkout.stripe.com/..." }` |

Crée ou réutilise un Stripe Customer. Mode `subscription`. **Secrets** : `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_ELITE`, `APP_REDIRECT_URL`, `APP_ORIGIN`

### `create-payment-session`
| Clé | Valeur |
|-----|--------|
| Méthode | POST |
| Auth | JWT obligatoire |
| Entrée | `{ product: 'flame_freeze'|'points_2000' }` |
| Sortie | `{ url: "https://checkout.stripe.com/..." }` |

Mode `payment` (one-time). Le crédit est posé par `stripe-webhook`, jamais ici. **Secrets** : `STRIPE_SECRET_KEY`, `STRIPE_PRICE_FLAME_FREEZE`, `STRIPE_PRICE_POINTS_2000`, `APP_REDIRECT_URL`, `APP_ORIGIN`

### `create-portal-session`
| Clé | Valeur |
|-----|--------|
| Méthode | POST |
| Auth | JWT obligatoire |
| Entrée | `{}` |
| Sortie | `{ url: "https://billing.stripe.com/..." }` |

Ouvre le Customer Portal Stripe (gestion/résiliation abonnement). **Secrets** : `STRIPE_SECRET_KEY`, `APP_REDIRECT_URL`, `APP_ORIGIN`

### `stripe-webhook`
| Clé | Valeur |
|-----|--------|
| Méthode | POST |
| Auth | Signature Stripe (`whsec_...`) — déployer `--no-verify-jwt` |
| Entrée | Payload Stripe signé |

**Événements traités** :
- `checkout.session.completed` (mode=payment) → `apply_one_time_purchase` RPC (idempotent sur `session_id`)
- `customer.subscription.created/updated` → `apply_subscription_change` RPC
- `customer.subscription.deleted` → `apply_subscription_change` (status=canceled)

**Secrets** : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

### `send-web-push`
| Clé | Valeur |
|-----|--------|
| Méthode | POST |
| Auth | JWT obligatoire |
| Entrée | `{ recipient_id, title, body, url, tag? }` |
| Sortie | `{ sent: N, removed: N_dead }` |

Vérifie amitié acceptée. Envoie à tous les abonnements Web Push du destinataire. Purge automatique des abonnements expirés (404/410). **Secrets** : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `APP_ORIGIN`

> **CORS** : toutes les Edge Functions lisent `APP_ORIGIN` (`Deno.env.get('APP_ORIGIN') ?? '*'`). Définir ce secret dans Supabase Dashboard pour restreindre à l'URL Vercel en production.

---

## Fonctions PostgreSQL (RPCs)

### Trigger `profiles_guard_sensitive_trigger`
`BEFORE UPDATE` sur `profiles`. UPDATE directe depuis le client sur les colonnes sensibles → silencieusement annulée. RPCs SECURITY DEFINER contournent via `set_config('app.bypass_profile_guard', 'on', true)`.

**Colonnes protégées** : `points`, `niveau`, `has_analysis_pass`, `has_ootd_plus_pass`, `daily_credits`, `credits_reset_date`, `unlocked_themes`, `unlocked_logos`, `active_theme`, `active_logo`, `flame_freezes`, `last_freeze_grant`.

### `compute_niveau(p_pts integer)` — IMMUTABLE
Miroir JS de `lib/utils.js#computeNiveau`. Retourne le niveau entier (seuil ×1.8). **Doit rester synchronisé avec le JS.**

### `consume_daily_credit(p_user_id)` — SECURITY DEFINER
Appelée par `analyze-outfit` **et** `contextual-analysis` (même quota partagé). Vérifie `auth.uid() = p_user_id`, reset si nouveau jour, décrémente `daily_credits`. Gère le tier Elite (illimité). Retourne `jsonb {ok, credits, max_credits}`.

### `check_analyze_rate_limit(p_max_per_minute)` — SECURITY DEFINER
Appelée par `analyze-outfit` et `contextual-analysis` **avant** `consume_daily_credit`. Fenêtre glissante 1 min. Atomic (FOR UPDATE). Retourne `boolean`.

### `award_points_for_ootd(p_ootd_id)` — SECURITY DEFINER
Appelée par `AccueilScreen.publishToFeed`. Lit `score_global` depuis la DB (clampe 1–10), calcule `points_earned = ROUND(score * 3)`, met à jour `points` et `niveau`. Retourne `jsonb {ok, points_earned, new_points, new_niveau}`.

### `increment_style_stats(p_styles text[])` — SECURITY DEFINER
Appelée par `AccueilScreen.publishToFeed` si le post a des tags de style. Incrémente, pour `auth.uid()`, un compteur par style dans `profiles.style_stats` (jsonb, via `jsonb_set`).

### `buy_pass(pass_type)` — SECURITY DEFINER
Valide points (400 ou 500), déduit, active flag, crédite 20 analyses/j. Si `ootdplus` : déverrouille tous thèmes et logos.

### `buy_cosmetic(item_type, item_id)` / `equip_cosmetic(item_type, item_id)` — SECURITY DEFINER
`buy_cosmetic` valide l'item contre des listes autorisées côté serveur et vérifie les points (400–1500 selon rareté), ajoute à `unlocked_*`. Whitelist `logo` étendue (migration `20260614120000`) avec les 5 logos-image : `bleu_neon` (500 pts), `sunset` (600 pts), `vert_neon` (500 pts), `rose_flashy` (650 pts), `rose_pastel` (750 pts) — mêmes colonnes `unlocked_logos`/`active_logo` que les logos emoji. `equip_cosmetic` vérifie ownership (`unlocked_*` ou Elite), met à jour `active_theme`/`active_logo`.

### `restore_flamme(p_flamme_id)` — SECURITY DEFINER
Fenêtre 48h post-expiration. Consomme 1 gel (`flame_freezes -= 1`), ranime `last_snap_at = now()`.

### `claim_monthly_freezes()` — SECURITY DEFINER
Idempotente par mois (`last_freeze_grant`). Free → +1 gel, Elite → +2 gels. Appelée au focus Shop et FlammesScreen.

### `toggle_message_like(p_id, p_liked)` — SECURITY DEFINER
Destinataire uniquement. Toggle `is_liked` sur le message. Retourne `boolean`.

### `delete_message(p_id)` — SECURITY DEFINER
Expéditeur uniquement. Soft delete (`is_deleted = true`). Retourne `image_url` pour nettoyage Storage côté client.

### `mark_messages_read(p_friend_id)` — SECURITY DEFINER
Met `read_at = now()` sur tous les messages reçus non lus dans la conversation. Retourne count mis à jour.

### `apply_one_time_purchase(p_user_id, p_product, p_session_id)` — SECURITY DEFINER
Appelée par `stripe-webhook`. Idempotente sur `session_id`. Crédite `flame_freezes` ou `points` selon `p_product`.

### `apply_subscription_change(p_user_id, p_status, p_plan_type, p_subscription_id, ...)` — EXECUTE réservé `service_role`
Met à jour la table `subscriptions`. Seul le webhook Stripe peut appeler cette fonction.

---

## Schéma de base de données

### `profiles`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | = auth.users.id |
| username | text UNIQUE NOT NULL | |
| avatar_url | text | URL publique bucket `avatars` |
| points | integer DEFAULT 0 | Via RPC uniquement |
| niveau | integer DEFAULT 1 | Via RPC uniquement |
| daily_credits | integer DEFAULT 2 | Via RPC uniquement |
| credits_reset_date | date | Via RPC uniquement |
| has_analysis_pass | boolean DEFAULT false | Pass legacy |
| has_ootd_plus_pass | boolean DEFAULT false | Pass legacy |
| flame_freezes | integer DEFAULT 0 | Gels flamme (via RPC) |
| last_freeze_grant | date | Idempotence claim mensuel |
| unlocked_themes | text[] DEFAULT ['default'] | |
| unlocked_logos | text[] DEFAULT ['default'] | Inclut logos emoji + logos image |
| active_theme | text DEFAULT 'default' | |
| active_logo | text DEFAULT 'star' | |
| is_private | boolean DEFAULT false | |
| bio | text | max 160 chars |
| style_stats | jsonb DEFAULT '{}' | Compteur par style, via RPC `increment_style_stats` |
| specialized_feed | boolean DEFAULT false | Toggle flux "Pour toi" personnalisé par style |
| analysis_personality | text DEFAULT 'fashion_week' | Ton du critique IA (`analyze-outfit`) — CHECK sur 5 clés fermées |
| created_at | timestamptz | |

> `user_metadata.dark_mode` (Supabase Auth, hors table `profiles`) stocke la préférence dark/light cross-device — voir `lib/themeContext.js`.
>
> **Colonnes protégées par trigger** : `points`, `niveau`, `has_*_pass`, `daily_credits`, `credits_reset_date`, `unlocked_*`, `active_theme`, `active_logo`, `flame_freezes`, `last_freeze_grant`.

### `profiles_private`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | = auth.users.id |
| push_token | text | Token Expo Push |

RLS owner-only (SELECT/INSERT/UPDATE). Invisible pour les autres utilisateurs.

### `ootds`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| user_id | uuid | → auth.users |
| image_url | text NOT NULL | CHECK NOT VALID `^https://[a-z0-9-]+\.supabase\.co/storage/` |
| score_global | numeric | IA: `global` |
| score_couleurs | numeric | IA: `harmonie` |
| score_coupe | numeric | IA: `fit` |
| score_tendance | numeric | IA: `detail` |
| conseil | text | Feedback IA |
| caption | text | Légende user (max 200 chars) |
| audio_title | text | Titre Deezer sélectionné |
| audio_artist | text | Artiste Deezer |
| audio_preview_url | text | URL preview MP3 30s |
| audio_cover_url | text | URL cover album |
| is_public | boolean DEFAULT true | false = galerie privée |
| styles | text[] DEFAULT '{}' | Tags de style IA (1-2, whitelist 20) |
| show_style_hashtag | boolean DEFAULT true | Choix de l'auteur, affichage public |
| visible_scores | text[] DEFAULT '{}' | Noms de colonnes scores affichées publiquement |
| created_at | timestamptz | |

### `likes`
UNIQUE(user_id, ootd_id). Append-only (pas d'UPDATE).

### `comments`
`body` : CHECK len > 0 AND <= 1000. `user_id` → `profiles.id`.

### `friendships`
PK(user_id, friend_id). `status` : `pending` | `accepted` | `declined`. CHECK user_id <> friend_id. Direction : `user_id` = demandeur, `friend_id` = destinataire.

> `declineRequest` utilise DELETE (pas UPDATE vers 'declined').

### `flammes`
`user1_id < user2_id` (**invariant SQL** — utiliser `flammeOrderedIds()`). Streak calculé par jours calendaires ISO, pas fenêtre 24h glissante.

### `messages`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| sender_id | uuid | → auth.users |
| receiver_id | uuid | → auth.users |
| content | text | nullable |
| image_url | text | CHECK NOT VALID `^https://[a-z0-9-]+\.supabase\.co/storage/` |
| audio_url | text | Message vocal (nullable) |
| score_global / score_couleurs / score_coupe / score_tendance | numeric | Notes IA si tenue analysée partagée (nullable) |
| conseil | text | Conseil IA (nullable) |
| is_liked | boolean DEFAULT false | Toggle par destinataire (RPC) |
| is_deleted | boolean DEFAULT false | Soft delete (RPC) |
| read_at | timestamptz | Accusé de lecture (RPC) |
| reply_to_id | uuid FK messages(id) ON DELETE SET NULL | Swipe-to-reply |
| created_at | timestamptz | |
| expires_at | timestamptz | now() + 24h |

CHECK `messages_has_content` : `is_deleted = true OR content IS NOT NULL OR image_url IS NOT NULL OR audio_url IS NOT NULL`

### `stories`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| user_id | uuid | → auth.users |
| image_url | text | nullable si video_url présent |
| video_url | text | nullable si image_url présent |
| overlay_text | text | max 60 chars |
| caption | text | max 200 chars |
| expires_at | timestamptz | now() + 24h |

CHECK `stories_has_media` : `image_url IS NOT NULL OR video_url IS NOT NULL`

### `subscriptions`
| Colonne | Type | Notes |
|---------|------|-------|
| user_id | uuid PK | → auth.users |
| stripe_customer_id | text | |
| stripe_subscription_id | text | |
| status | text | inactive / active / trialing / canceled |
| plan_type | text | plus / elite |
| current_period_end | timestamptz | |
| cancel_at_period_end | boolean | |

RLS lecture seule pour le propriétaire. Mutations via `service_role` uniquement (webhook).

### `web_push_subscriptions`
Subscription Web Push par device : `user_id`, `endpoint`, `p256dh`, `auth`. RLS owner-only.

### `analyze_rate_limit`
`user_id` PK, `window_start` timestamptz, `req_count` integer. Aucune policy RLS — accès via SECURITY DEFINER uniquement. Partagée par `analyze-outfit` et `contextual-analysis`.

### `snaps` (legacy)
Insert par `AccueilScreen.sendOutfitToSelectedFlammes`. Limité à 1/jour/paire (`hasSnapUsedTodayForPair`). Contrainte amitié acceptée (RLS). Porte aussi `score_global/couleurs/coupe/tendance` + `conseil` (nullable) depuis migration `20260621120000`.

---

## Politiques RLS (résumé)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| profiles | tous auth | soi (trigger annule colonnes sensibles) | soi (trigger) | — |
| profiles_private | soi | soi | soi | — |
| ootds | auth + is_private/ami | soi | — | soi |
| likes | tous auth | soi | — | soi |
| comments | tous auth | soi | — | soi |
| friendships | impliqué | demandeur (`status=pending`) | destinataire (`pending→accepted/declined`) | les deux |
| flammes | impliqué | impliqué | impliqué | — |
| messages | impliqué | sender + amitié acceptée | — | sender |
| snaps | impliqué | sender + amitié acceptée | — | — |
| stories | auteur ou ami + non expiré | user_id=uid | — | user_id=uid |
| subscriptions | soi | — | — | — |
| web_push_subscriptions | soi | soi | — | soi |
| analyze_rate_limit | (aucune) | (aucune) | (aucune) | (aucune) |

---

## Storage Supabase

| Bucket | Visibilité | Politique INSERT | Chemins |
|--------|-----------|-----------------|---------|
| `avatars` | Public | `<uid>/…` uniquement | `<uid>/avatar.jpg` |
| `ootds` | Public | `<uid>/…` ou `ootds/messages/<uid>/…` ou `ootds/audio/<uid>/…` | `<uid>/outfit_<ts>.{jpg,webp}` · `messages/<uid>/<ts>.jpg` · `audio/<uid>/<ts>.{webm,m4a}` |
| `stories` | Public | `<uid>/…` uniquement | `<uid>/<ts>.mp4` |

Toutes les policies INSERT vérifient `split_part(name,'/',1) = uid`. Le bucket `ootds` autorise désormais les MIME audio (`audio/mp4`, `audio/webm`, `audio/ogg`, `audio/mpeg`, `audio/x-m4a`) en plus des images (migration `20260617150000`).

---

## Système de crédits et tiers

| Tier | Condition | Analyses/jour | Gels/mois |
|------|-----------|---------------|-----------|
| Gratuit | — | 2 | 1 |
| Plus | Stripe sub `plus` | 20 | 1 |
| Elite | Stripe sub `elite` | ∞ | 2 |
| Pass legacy | `has_analysis_pass` ou `has_ootd_plus_pass` | 20 | 1 |

Rate-limit indépendant : 5 req/min par user (table `analyze_rate_limit`), **partagé** entre `analyze-outfit` et `contextual-analysis` (le crédit quotidien aussi).

---

## Design responsive

| Élément | Formule |
|---------|---------|
| Score ring (Accueil) | `Math.min(Math.round(screenWidth × 0.22), 96)` |
| Logo (Auth) | `Math.min(Math.round(screenHeight × 0.17), 140)` |
| Avatar (Profil) | `Math.min(Math.round(screenWidth × 0.22), 90)` |
| Bulles photo (chat) | `Math.round(screenWidth × 0.55)` |

---

## Configuration Expo / EAS

### `app.json`
- Bundle ID iOS : `com.medifreymann.ootd`, Package Android : `com.medifreymann.ootd`
- EAS project ID : `4efa34fb-675c-4892-a67a-44f6d1b4d759`
- `scheme: "ootd"` (deep links Stripe : `ootd://shop`)
- Permission Android : `POST_NOTIFICATIONS`, iOS background modes : `remote-notification`
- Plugin expo-notifications : couleur `#ED93B1`, canal `default`
- Plugin expo-media-library : message de permission FR (`downloadImageToDevice`)
- **Pas de plugin `expo-camera` déclaré** malgré l'usage de `InAppCamera` — les messages de permission caméra/micro iOS (`NSCameraUsageDescription`, `NSMicrophoneUsageDescription`) seront donc les textes par défaut du module, pas de texte FR custom

### `eas.json`
- `preview` : Android APK (test)
- `production` : Android AAB + iOS (stores)
- `appVersionSource: "remote"` (versioning géré sur expo.dev)

---

## Points d'attention pour évolution future

- **Score insert non validé** : `ootds_insert_own` n'empêche pas un client d'insérer `score_global=10`. `award_points_for_ootd` clampe mais le score affiché reste celui inséré. Résoudre en déléguant l'insert à une RPC.
- **`compute_niveau` dupliquée** : JS (`lib/utils.js`) + PL/pgSQL (`compute_niveau()`). Toute modification du barème doit être appliquée aux deux.
- **Notifications push serveur-side** : `sendPushNotification()` existe mais devrait être déclenché depuis une Edge Function (pas côté client) à l'insert d'un message ou like. Tokens dans `profiles_private` → via clé service uniquement.
- **Messages expirés état local** : `expires_at` filtre en DB mais les messages expirés peuvent rester dans le state local. Re-fetch au focus recommandé.
- **`lib/toast.js` orphelin** : event bus non utilisé, confirmé non importé nulle part. À supprimer.
- **Permission caméra/micro non personnalisée** : `InAppCamera` (photo tenue, chat, stories vidéo) utilise `expo-camera` sans plugin `expo-camera` déclaré dans `app.json` — messages de permission iOS en anglais par défaut au lieu du FR utilisé partout ailleurs. Ajouter le plugin avec des messages FR avant un prochain build EAS iOS/Android.
- **Variables `EXPO_PUBLIC_RC_APPLE_KEY`/`EXPO_PUBLIC_RC_GOOGLE_KEY`** (`.env.example`) : placeholders RevenueCat non consommés par le code actuel (aucun import `react-native-purchases`) — à ignorer ou retirer tant que l'intégration n'est pas commencée.
- **Stripe live** : actuellement en mode TEST (`sk_test_...`). Passer en `sk_live_...` = recréer produits + price IDs + webhook endpoint + mettre à jour secrets Supabase.
- **SEC-09 NOT VALID** : les contraintes `image_url` sont créées `NOT VALID`. Exécuter `VALIDATE CONSTRAINT ootds_image_url_valid` et `messages_image_url_valid` après nettoyage des éventuelles anciennes URLs.
- **SEC-10** : Limites taille/MIME sur buckets Storage à configurer dans Supabase Dashboard (avatars 5 Mo, ootds 10 Mo, stories 100 Mo).
