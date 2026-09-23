# ARCHITECTURE.md — Référence technique OOTD

> Dernière mise à jour : 2026-09-28 (corrections post-lancement écran Compétition v4 : 2 bugs d'embed PostgREST, police de la maquette, refonte visuelle de la liste des compétitions)

## Vue d'ensemble

Application mobile React Native / Expo (iOS, Android, **Web/PWA**). Architecture simple : **pas de state manager global**, chaque écran gère son propre state local. Supabase est la source de vérité (DB + Auth + Storage + Realtime + Edge Functions). L'IA est appelée **exclusivement via des Edge Functions Supabase** — les clés API ne sont jamais dans le bundle client.

**Pivot produit (2026-09) :** l'app est passée d'un modèle "amis 1-à-1 + streaks + Stories" à un modèle **"Compétitions"** — des groupes nommés où les membres partagent leurs tenues et discutent ensemble. Le chat 1-à-1, les streaks (flammes) et les Stories ont été retirés de l'UI ; `friendships` reste un concept indépendant (sert le classement "Top 3 amis" et la sélection des membres à la création d'une compétition).

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      App (Expo — iOS / Android / PWA)                    │
│  ┌─────────┐   ┌─────────────┐   ┌───────────┐   ┌────────┐             │
│  │ Analyse │   │ Compétitions│   │ Découvrir │   │ Récap  │             │
│  │(capture │   │(liste, créer│   │(feed      │   │(stats, │             │
│  │+ bandeau│   │ classement, │   │ public +  │   │réglages,│            │
│  │compét.) │   │ galerie,chat│   │ Palmarès) │   │abonnem.,│            │
│  └────┬────┘   └──────┬──────┘   └─────┬─────┘   │amis,   │            │
│       │               │                │         │graphe) │            │
│       │               │                │         └───┬────┘           │
│       └───────────────┴────────────────┴─────────────┘                  │
│                  Supabase Client (lib/supabase.js)                       │
└──────────────────────────────┬────────────────────────────────────────--┘
                               │
              ┌────────────────▼──────────────────────────┐
              │               Supabase (BaaS)              │
              │  DB (Postgres + RLS)   Auth (email/pwd)    │
              │  Storage (2 buckets)   Realtime (WS)       │
              │                                            │
              │  Edge Functions                            │
              │  ├─ analyze-outfit ──────► Gemini 2.5-flash│
              │  │                  └────► Groq (fallback) │
              │  ├─ deezer-search ────────► Deezer API     │
              │  ├─ create-checkout-session ──► Stripe     │
              │  ├─ create-payment-session ───► Stripe     │
              │  ├─ create-portal-session ────► Stripe     │
              │  ├─ stripe-webhook ◄──────────── Stripe    │
              │  └─ send-web-push ─────────► Web Push API  │
              └────────────────────────────────────────────┘
```

> `contextual-analysis` (analyse "cette tenue est-elle adaptée à telle situation ?") a été **retirée** (2026-09-24) — jugée inutile en usage réel. Ni le bouton, ni l'Edge Function n'existent plus.

---

## Navigation

`App.js` implémente un **BottomTabNavigator à 4 onglets** (décision D2, 2026-09-25 — auparavant 3), chacun enveloppant sa propre **stack native** (`@react-navigation/native-stack`) pour supporter la profondeur nécessaire. Le gardien d'auth est dans `App()`. `ThemeProvider` et `ToastProvider` enveloppent tout.

```
App.js
 ├── loading=true  → <ActivityIndicator>
 ├── recovery=true → <ResetPasswordScreen>            (lien de récupération cliqué)
 ├── session=null  → <ThemeProvider><ToastProvider><AuthScreen>
 └── session ok    → <ThemeProvider>
                       <ToastProvider>
                         <ThemedNavigator>
                           ├── Accueil (✨ "Analyse")     → AccueilStack
                           │     ├── AccueilHome          → AccueilScreen (capture + bandeau compact compétitions)
                           │     ├── ShareToCompetition    → ShareToCompetitionScreen
                           │     └── Competition           → CompetitionScreen (voir plus bas — présent aussi ici pour le replace() post-partage)
                           ├── Compétitions (🏆, nouveau) → CompetitionsStack
                           │     ├── CompetitionsHome     → CompetitionsListScreen (liste "Mes compétitions", ex-section d'AccueilScreen)
                           │     ├── CreateCompetition     → CreateCompetitionScreen
                           │     ├── Competition            → CompetitionScreen (classement + galerie + chat)
                           │     └── JoinCompetition         → JoinCompetitionScreen (deep link invitation, retargeté ici)
                           ├── Feed (🧭 "Découvrir")      → DecouvrirStack
                           │     ├── Feed                 → FeedScreen (headerShown: false, plein écran, inchangé)
                           │     └── Palmares              → PalmaresScreen (podium + graphique, décision D3)
                           └── Récap   (👤) → RecapStack
                                 ├── RecapHome → RecapScreen (stats, niveau, graphe perso, galerie)
                                 ├── Shop      → ShopScreen (abonnement, achats express, cosmétiques)
                                 └── Friends   → FriendsScreen (recherche + demandes d'amis)
```

> **Noms de route internes volontairement inchangés** (`Accueil`, `Feed`, `Récap`) malgré le renommage des libellés affichés (`tabBarLabel: 'Analyse'`/`'Découvrir'`) — plusieurs écrans font des `navigate()` cross-tab par nom brut (`ShareToCompetitionScreen.navigate('Feed')`, `CreateCompetitionScreen.navigate('Récap', {screen:'Friends'})`) qui auraient cassé silencieusement si le `name` du `Tab.Screen` avait changé en même temps que son libellé. Seul l'onglet réellement nouveau porte un nom de route qui matche son libellé (`Compétitions`).
>
> `Competition` (détail d'une compétition) est enregistré **dans deux stacks** (`AccueilStack` et `CompetitionsStack`) : `ShareToCompetitionScreen.navigation.replace('Competition', ...)` ne peut cibler qu'un écran du **même** stack (`replace()`, contrairement à `navigate()`, ne fait pas de recherche cross-navigateur) — dupliquer l'enregistrement du composant est le moyen le plus simple de satisfaire ce besoin sans changer la sémantique `replace` (qui évite de revenir sur l'écran de partage via le bouton retour).

**Header** : tous les onglets utilisent `headerShown: false` au niveau de leur propre `Tab.Screen`/stack (chaque écran gère son propre header, ou n'en affiche pas — `CompetitionScreen`/`PalmaresScreen` ont leur propre barre custom avec chevron retour).

**Navigation cross-tab** : pour naviguer d'un onglet vers un écran d'une stack sœur, utiliser la forme `navigation.navigate('Récap', { screen: 'Shop' })` (jamais `navigation.navigate('Shop')` seul si l'appelant est dans une autre stack) — **sauf** pour un écran qui est le **premier/racine** d'une stack elle-même nommée comme une route de niveau tab (ex. `navigate('Feed')` cible directement l'onglet Découvrir et affiche son écran initial `Feed` à l'intérieur de `DecouvrirStack`, sans syntaxe imbriquée).

**Auth flow** : `App.useEffect` appelle `supabase.auth.getSession()`, puis écoute `onAuthStateChange`. `syncSession()` enchaîne `ensureUserProfile()`, la consommation d'un éventuel **token d'invitation en attente** (voir ci-dessous), l'enregistrement push (natif) et `registerWebPush()` (PWA). Sur web, les tokens de récupération de mot de passe sont parsés manuellement depuis le hash **et** la query string (`parseAuthParams`) pour fiabiliser Safari iOS/PWA, avec pose de session explicite (`setSession`/`verifyOtp`/`exchangeCodeForSession`).

**Deep link d'invitation compétition** (`?join_competition=<token>`) :
- Capturé dans `AsyncStorage['@ootd_pending_join_token']` **dès le chargement de la page**, même si aucune session n'existe encore (cas d'un nouvel utilisateur qui doit d'abord s'inscrire).
- Consommé dans `syncSession()` dès qu'une session existe (que ce soit `getSession()` au démarrage ou un login/signup qui vient de se produire) → navigue vers l'onglet **Compétitions** (`navigate('Compétitions', { screen: 'JoinCompetition', params: { token } })`, retargeté depuis `Accueil` le 2026-09-25 suite au déplacement de `JoinCompetitionScreen` dans `CompetitionsStack`).
- Cas "app déjà ouverte + session déjà active" (clic sur le lien pendant que le PWA tourne) : géré séparément via le message `postMessage` du service worker (même retarget).
- `JoinCompetitionScreen` affiche toujours un aperçu (nom + nombre de membres via `get_competition_invite_preview`, appelable sans compte) et exige un tap explicite sur "Rejoindre" — **jamais d'adhésion automatique au chargement** (un lien peut être périmé, révoqué ou transféré).
- Clic sur une notification native (rappel quotidien) → route vers l'onglet Accueil si l'URL contient "analyse".

> L'ancien deep link `?chat=<id>` (ouverture directe d'une conversation 1-à-1) a disparu avec le chat 1-à-1 lui-même.

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
- Toggle UI : `RecapScreen` → modal Réglages → section "Apparence" (switch lune/soleil animé `Animated.spring`).

### `lib/logoConfig.js` — `getLogoConfig(logoId)`

**10 logos** au total, deux familles :
- **5 logos emoji** (badge/cadre) : `default` (⭐), `diamond` (💎, bleu), `crown` (👑, or), `fire` (🔥, orange), `star` (🌟, jaune) — exposent `emoji`, `frameBorderColor`, `postIcon`, `badge`.
- **5 logos image** (`assets/logos/*.jpg`) : `bleu_neon`, `sunset`, `vert_neon`, `rose_flashy`, `rose_pastel` — exposent `frameBorderColor` + un champ `image` (`require(...)`), pas de `badge`/`postIcon`.

`getLogoConfig()` retourne la config correspondante ou `default` si `logoId` est inconnu. Consommé par `AppHeader` (logo dans le header, fallback `assets/logo.jpg` si pas de champ `image`), `Avatar`, `FeedScreen`, `RecapScreen`.

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
Reçoit `{ navigation }` de React Navigation. Racine de la stack `AccueilStack`.

**Phase 1 — Sélection image**
- `openImageSourcePicker()` : Alert.alert avec choix caméra/galerie
- **Caméra** : `<InAppCamera mode="photo">` (composant custom plein écran, `expo-camera`) — **Galerie** : `expo-image-picker`
- Compression systématique via `expo-image-manipulator` : max 1280px, JPEG 0.78 pour l'IA, WebP 0.72 pour le stockage (fallback JPEG sur web)
- Cooldown anti-double-analyse : 5 min sur la même image (`lastAnalyzedRef`)
- Recadrage : `CROP_ASPECT = 9/16` (constante locale, reprise de l'ancien `components/StoryMedia.js` supprimé avec les Stories)

**Phase 2 — Crédits**
- Tier Elite (Stripe) → illimité
- Tier Plus/pass → 20/jour
- Gratuit → 2/jour
- Si `credits === 0` : carte `noCreditsCard` + bouton "Obtenir plus" → Récap → Shop
- Tier résolu via `lib/tier.resolveTier()` (`userTier` state) — partagé avec RecapScreen/ShopScreen

**Rappels de monétisation** (cartes réutilisant le style `noCreditsCard`) :
| Rappel | Condition | Fréquence | Stockage throttle |
|---|---|---|---|
| Dernière analyse du jour | `userTier==='free' && credits===1` | 1×/jour | `AsyncStorage['@ootd_reminder_lastcredit_date']` |
| Note ≥ 80/100 | Résultat `global >= 80` et `userTier !== 'elite'` | 1× / 3 jours | `AsyncStorage['@ootd_reminder_highscore_ts']` |

**Phase 3 — Analyse IA**
- `supabase.functions.invoke("analyze-outfit", { body: { base64Image, personality } })`
- `base64Image` = `data:image/{jpeg|png|webp};base64,{raw}` (préfixe MIME obligatoire)
- `personality` = clé fermée lue depuis `profiles.analysis_personality`, fallback `'coach'`
- Rate-limit : 5 requêtes/minute (`check_analyze_rate_limit` RPC)
- Timeout : 25 secondes via `withTimeout()`
- **Note sur 100** (v3, 2026-09) : 3 jauges arc (Fit /33, Harmonie /34, Détails /33) via `components/Gauge.js` (`max` dynamique par critère), note globale = somme directe des 3 (pas de moyenne), 1-2 hashtags de style
- **`photo_complete: false`** : si l'IA juge la photo trop incomplète (buste seul, cadrage trop serré) pour noter équitablement, aucun score n'est calculé et **aucun crédit n'est consommé** — un bandeau "Photo incomplète" (raison + bouton "Reprendre la photo") s'affiche à la place du résultat (state `photoIncomplete`)
- Animations : fade + rise + scale (AnimatedEntrance)

> L'ancienne "analyse contextuelle" (bouton "Conseil contextuel", Edge Function `contextual-analysis`) a été **retirée entièrement** (2026-09-24).

**Bloc conseil compact** : une seule ligne (`tipCardCompact`) sous le bouton d'analyse — remplace l'ancien bloc "Carte conseil" + 3 cartes "Comment ça marche ?", pour laisser plus de place à la liste des compétitions juste en dessous.

**Bandeau compétitions compact** (2026-09-25, décision D2 — remplace l'ancienne section "Mes compétitions" pleine liste, déplacée dans `CompetitionsListScreen`) : une seule ligne sous le bloc conseil, ex. "3 ligues actives · 2 nouveaux messages →", dérivée de 2 requêtes de comptage légères (`head: true`, pas de fetch de la liste complète) — nombre de lignes `competition_members` de l'utilisateur, et somme des `competition_messages` postérieurs à `last_read_at` par compétition. Tap → `navigation.navigate('Compétitions')` (cross-tab).

**Phase 4 — Personnalisation (CustomizationScreen modal)**
- Ajout caption (200 chars max)
- Sélection musique Deezer (proxy Edge Function → 10 résultats, autoplay preview 30s MP3 à la sélection)
- Toggle "afficher mes hashtags de style" (si `score.styles.length > 0`) → `ootds.show_style_hashtag`
- Choix des notes visibles publiquement → `ootds.visible_scores`
- **Un seul bouton "Continuer"** (plus de choix publier/flammes/enregistrer ici) → upload de l'image puis navigation vers `ShareToCompetitionScreen` (la tenue en attente est portée par `lib/pendingOutfit.js`, un singleton hors React, pas par les route params — évite de sérialiser l'image dans la navigation)

**Phase 5 — Partage (ShareToCompetitionScreen, écran séparé)**
- Multi-sélection des compétitions dont l'utilisateur est membre + toggle indépendant "Rendre publique (Feed)"
- Un seul appel atomique `submit_ootd_to_competitions` RPC (insère `ootds`, relie chaque compétition sélectionnée via `ootd_competitions`, attribue les points, incrémente les stats de style) — remplace les anciens chemins séparés publier/flammes/enregistrer
- 0 compétition sélectionnée + public désactivé = équivalent de l'ancien "Enregistrer pour soi"

**Mapping scores IA → DB :**
```
IA:  global         fit           harmonie        detail          styles
DB:  score_global   score_coupe   score_couleurs  score_tendance  styles (text[])
```

### FeedScreen (`screens/FeedScreen.js`)
Inchangé dans son fonctionnement depuis la refonte Compétitions — reste le flux public de découverte (amis qui partagent publiquement + comptes publics), indépendant des compétitions (`ootds.is_public`).
- **UX TikTok** : `FlatList` `snapToInterval=pageH`, `snapToAlignment="start"`, `disableIntervalMomentum`, `decelerationRate="fast"`, chaque item = plein écran. **Sur web**, complété par du vrai CSS scroll-snap (`scrollSnapType`/`scrollSnapAlign`/`scrollSnapStop`, styles `feedListWeb`/`feedPageWeb`, `Platform.OS === 'web'` uniquement)
- **Fetch** : `ootds` joint `profiles(username, avatar_url, active_logo, is_private)`, `likes(id, user_id)`, `comments(count)` + colonnes `styles, show_style_hashtag, visible_scores` — pagination 10/page, chargement infini (`onEndReached`)
- **Confidentialité** : posts `is_private` filtrés côté DB sauf auteur ou ami accepté
- **Recherche** : bouton loupe → overlay `TextInput` — filtrage côté client sur `username`, `caption`, `styles[]`
- **Toggle "œil" notes**, **hashtags de style**, **flux "Pour toi" spécialisé** (`profiles.specialized_feed`), **musique** auto-play, **double-tap like**, **partage** (vers une compétition ou en message direct — voir CompetitionScreen), **commentaires** (`FeedCommentsModal`) : comportement inchangé, voir le code pour le détail.
- **Icône Palmarès** (2026-09-25, décision D3) : bouton rond supplémentaire dans la barre d'icônes du haut (`Feather name="award"`, à côté du bouton "notes") → `navigation.navigate('Palmares')` (sibling dans `DecouvrirStack`). Ajout purement additif, aucun comportement existant du Feed modifié.

### CompetitionsListScreen (`screens/CompetitionsListScreen.js`) — nouveau (2026-09-25), refonte visuelle 2026-09-28
Racine de l'onglet Compétitions. Reprend fidèlement l'ancien fetch d'`AccueilScreen` (liste `competition_members` joint `competitions`, tap → `CompetitionScreen`, bouton "Créer une compétition" → `CreateCompetitionScreen`) — erreurs affichées en toast plutôt qu'avalées silencieusement (c'est l'écran principal de l'onglet), rafraîchi via `useFocusEffect`.
- **2026-09-28** : palette/police alignées sur `CompetitionScreen` (mêmes `C`/`FONT_DISPLAY`/`FONT_BODY` de `lib/competitionFonts.js`, dégradé de fond) au lieu du `useTheme()` générique — cohérence visuelle de toute l'aire "Compétitions". Ajout du nombre de membres par ligue (requête de comptage supplémentaire par ligne, même pattern que le badge non-lu) et d'un bloc vide illustré.

### PalmaresScreen (`screens/PalmaresScreen.js`) — nouveau (2026-09-25, décision D3)
Remplace un chat public global envisagé puis écarté (risque de modération/harcèlement sur une app qui note l'apparence). Accessible depuis le Feed via l'icône trophée. Sélecteur Semaine/Mois → `get_top3_app`/`get_top3_friends` (désormais paramétrées par `p_period`). Rendu : podium simplifié (liste + médailles 🥇🥈🥉, pas d'étagères) pour Top 3 app et Top 3 amis, plus un petit graphique en barres SVG (`react-native-svg`, même bibliothèque que `components/Gauge.js`) des scores du Top 3 app, barre de l'utilisateur courant mise en évidence.
- **2026-09-30** : colonne de sortie renommée `best_score` → `score` (voir décision juste en dessous du tableau RPC) ; cet écran n'exposant que Semaine/Mois, `score` y est toujours une moyenne (`ROUND(AVG(score_global),1)`), jamais un record.

### CompetitionScreen (`screens/CompetitionScreen.js`) — réécrit 2026-09-27 ("maquette v4, gestes séparés")
Reçoit `{ route: { params: { competitionId, competitionName } }, navigation }`. **Deux pages glissables** (pas des onglets React Navigation — un pager maison à base de `PanResponder`/`Animated`, `panelIndex` 0|1) : **Photos & chat** puis **Classement**, permutables via les boutons du switcher ou un glissement horizontal de toute la page (seuil 20% de la largeur, rubber-band aux bords, désactivé quand le viewer plein écran est ouvert).

> Écran à **palette fixe** (`const C = {...}` en tête de fichier, sombre, couleurs reprises 1:1 de la maquette HTML validée par l'utilisateur) — volontairement indépendant de `useTheme()`/du thème clair-sombre du reste de l'app, décision assumée pour préserver le rendu exact de la maquette.

> **Police fidèle à la maquette** (`lib/competitionFonts.js`, nouveau 2026-09-28) : la première version de cet écran (2026-09-27) rendait tout dans la police système par erreur — aucun chargement de police custom n'avait été fait. La maquette utilise 'Baloo 2' (titre, scores, rangs, initiales des avatars fantômes — toujours en graisse 700) et 'Plus Jakarta Sans' (tout le reste, plusieurs graisses : regular/medium/semibold/bold). Chargées via `@expo-google-fonts/baloo-2`/`@expo-google-fonts/plus-jakarta-sans`, hook partagé `useCompetitionFonts()` (aussi utilisé par `CompetitionsListScreen`) — écran affiche un spinner tant que les polices ne sont pas prêtes. Chaque fichier TTF étant à graisse fixe, `fontFamily` (via `FONT_DISPLAY`/`FONT_BODY.<graisse>`) remplace `fontWeight` partout sur ces écrans plutôt que de les combiner.

**Photos & chat**
- *Tenues du jour* : une vignette par membre de la compétition (`competition_members` joint `profiles`, LEFT JOIN sur `ootd_competitions`/`ootds` filtré à la fenêtre du jour local via `getLocalDayIsoRange()`) — photo + score si posté aujourd'hui, avatar fantôme + "n'a pas encore posté" sinon. **Remplace l'ancienne galerie historique complète** (tri par date/score, tout l'historique) — voir Post-mortems / limitations si le besoin de parcourir l'historique remonte.
- Tap sur une vignette (remplie ou vide) → **viewer plein écran** (`fsOpen` state, overlay absolu) : 4 directions à sens unique et axe verrouillé au premier mouvement (`Math.abs(dx) > Math.abs(dy)*1.15` → axe X, sinon Y) — gauche/droite change de membre (pager interne `fsTrackX`), bas dézoome+ferme (translateY/scale/opacity), haut ouvre un champ de réponse superposé à la photo (`fsReply`, envoi sans quitter le plein écran — le message part dans le chat avec `quoted_label = "Réponse à la tenue de <nom>"`, pas de `reply_to_id` car il n'y a pas de message existant à cibler).
- Chat de groupe : table `competition_messages` (inchangée dans son rôle), liste **chronologique** (haut→bas, auto-scroll en bas via `onContentSizeChange`) — remplace l'ancienne `FlatList inverted`.
  - **Swipe-to-reply** : glissement horizontal (droite uniquement, clampé à 64px) sur la ligne d'un message → ouvre la barre de réponse (bandeau au-dessus du champ de saisie), la citation (`reply_to_id`, résolue dynamiquement depuis les messages déjà chargés — jamais dupliquée en dur) s'affiche dans la nouvelle bulle envoyée.
  - **Likes** (`competition_message_likes`, plusieurs personnes par message, compteur agrégé) via RPC `toggle_competition_message_like` — toggle atomique.
  - **Réactions emoji** (`competition_message_reactions`, whitelist fermée de 5 emoji verrouillée aussi côté DB) via RPC `add_competition_message_reaction` — ajout uniquement en V1, pas de retrait.
  - Soft-delete par appui long (RPC `delete_competition_message`, expéditeur uniquement) — inchangé.
  - **Limitation connue** : likes/réactions ne se synchronisent pas en temps réel entre plusieurs appareils (seul l'auteur de l'action voit la mise à jour immédiate) — seuls les nouveaux messages restent temps réel via le channel Realtime existant.
- Realtime : **un channel par compétition ouverte** (`competition-chat-<id>`, filtré `competition_id=eq.<id>`) — inchangé, voir Post-mortems.
- Bouton "Ajouter" dans le header → génère un lien via `create_competition_invite` et l'envoie via `Share.share()` — inchangé (ex-icône, désormais un bouton pilule avec libellé, fidèle à la maquette).
- **Menu "..." du header** (`menuOpen` state, 2026-09-29, audit des règles métier) : "Quitter la compétition" (RPC `leave_competition`, tous membres, confirmation destructive) et "Supprimer la compétition" (RPC `delete_competition`, affiché uniquement si `created_by === userId`, confirmation destructive) — les deux ferment le menu et font `navigation.goBack()` en cas de succès.

**Classement** (décisions D1/D5 du 2026-09-25 — logique d'agrégation revue le 2026-09-30, seul le rendu visuel avait changé le 2026-09-27)
- `get_competition_leaderboard(p_competition_id, p_period)` RPC — sélecteur de période (Jour/Semaine/Mois/Depuis toujours)
- **2026-09-30** : `MAX(score_global)` gardé uniquement pour "Jour" (record du jour) ; "Semaine"/"Mois"/"Toujours" utilisent désormais `ROUND(AVG(score_global),1)` (régularité plutôt que record — même logique que `most_improved`, déjà une moyenne). Colonne de sortie renommée `best_score` → `score`. Libellé affiché à côté de "Classement complet" : "meilleur score" (Jour) / "score moyen" (autres périodes).
- **Podium** (argent-or-bronze, 1er au centre en plus grand) : une place sans membre (compétition à moins de 3 membres) devient un CTA "Inviter" (→ `create_competition_invite`) plutôt qu'un membre fictif
- **Classement complet** : tous les membres, rang/avatar/nom (+tag "Toi")/badge 🔥`streak_count` si >0/score ou `—`
- **2 chips de reconnaissance** sous la liste : 🎯 Régularité (`most_regular`) et ❤️ Coup de cœur (`most_liked`) — `most_improved` (Progression) reste calculé côté RPC mais n'est plus affiché dans cette version de l'écran (la maquette validée ne montre que 2 chips) ; facile à réafficher si redemandé.

`lib/activeChat.js` (`setActiveCompetition`/`getActiveCompetition`) retient la compétition dont le chat est ouvert — inchangé.

### CreateCompetitionScreen (`screens/CreateCompetitionScreen.js`) — nouveau
- Nom (1-60 caractères) **et** sélection multiple des membres en une fois, parmi les amis déjà acceptés (`friendships`, mêmes requêtes que `FriendsScreen`) — pas de lien à générer pour démarrer
- RPC `create_competition_with_members(p_name, p_member_ids[])` : vérifie que chaque membre proposé est un ami accepté avant de l'ajouter, crée la compétition + tous les membres en une transaction
- Si l'utilisateur n'a pas encore d'amis : message + lien direct vers Récap → Mes amis
- La composition peut être modifiée plus tard via le lien d'invitation de `CompetitionScreen` (ajout après coup)

### ShareToCompetitionScreen (`screens/ShareToCompetitionScreen.js`) — nouveau
Voir "AccueilScreen — Phase 5" ci-dessus. Lit la tenue en attente via `getPendingOutfit()` (`lib/pendingOutfit.js`) ; si absente (retour arrière après coup), affiche un état vide avec bouton retour.

### JoinCompetitionScreen (`screens/JoinCompetitionScreen.js`) — nouveau
Voir "Navigation — Deep link d'invitation" ci-dessus. États : `loading` → `preview` (aperçu + bouton Rejoindre) → `joining` → `error` (lien invalide/expiré, bouton retour Accueil). Si l'utilisateur est déjà membre, `redeem_competition_invite` renvoie `already_member: true` sans dupliquer.

### RecapScreen (`screens/RecapScreen.js`) — nouveau, remplace ProfilScreen
Reprend le contenu de l'ancien `ProfilScreen` quasiment tel quel (modal Réglages, galerie paginée + lightbox, carte Niveau — lift-and-shift, pas une réécriture), réorganisé :

1. En-tête : titre "Récap" + bouton déconnexion + bouton "Télécharger l'app" (PWA)
2. Carte profil : avatar, pseudo, badge abonnement, stats (tenues / score moyen / points), top 3 styles
3. Carte "Niveau" (`computeLevelInfo`)
4. **Boutons Réglages / Abonnement / Mes amis** (juste sous la carte Niveau)
5. **Graphique perso "Mon évolution"** (2026-09-25, décision D6 — remplace les 2 blocs Top 3, déménagés dans `PalmaresScreen`) : toggle 7/30 jours, ligne SVG (`Polyline`+`Circle`, `react-native-svg`) tracée à partir du state `ootds` déjà chargé par `fetchProfil` (aucune requête réseau dédiée — peut donc ne pas couvrir toute la fenêtre si l'utilisateur publie plus de 21 fois sur la période, accepté pour cette V1), score normalisé via `(score_global / score_scale) * 100` (même formule que `moyenneScore`)
6. Galerie "Mes tenues" — grille 3 colonnes **avec bordure et espacement entre chaque photo** (`gridCell` padding 3 + `gridPhoto` bordure `rgba(128,128,128,0.28)`), pagination 21/page (tier Gratuit plafonné à la 1ère page), lightbox horizontal swipe enrichie (badge note globale **dénominateur dynamique** `/{score_scale}` — voir "Note sur 100" plus bas —, 3 badges colorés, chips de style, description, conseils IA structurés)

Modal Réglages : username, bio (160 chars), `is_private` toggle, toggle "contenu spécialisé", toggle apparence dark/light, sélecteur "Personnalité du critique IA" (grisé + 🔒 hors tier), email (RO), changement d'avatar.

Bouton "Abonnement" → `navigation.navigate('Shop')` (même stack, `RecapStack`). Bouton "Mes amis" → `navigation.navigate('Friends')`.

### FriendsScreen (`screens/FriendsScreen.js`) — nouveau, sous-écran de Récap
Repris de l'ancien `FlammesScreen.js` (demande/acceptation d'ami), **sans** chat ni streak — `friendships` reste un concept indépendant des compétitions (sert `get_top3_friends` et le sélecteur de membres de `CreateCompetitionScreen`, décision produit explicite plutôt que déduire "ami" de l'appartenance à une compétition commune).
- Barre de recherche pseudo (normalisation accents/emoji/casse) toujours visible en haut
- Liste "Demandes reçues" (si non vide) puis liste des amis acceptés
- Actions contextuelles par ligne : Ajouter / Accepter+Refuser / Demandée (annulable) / Amis ✓

### ShopScreen (`screens/ShopScreen.js`)
Inchangé fonctionnellement — self-contained (zéro props, propre `fetchData`), monté comme sous-écran de `RecapStack` au lieu d'un onglet dédié. 3 sections :

**1. Premium (Stripe — abonnements récurrents)**
| Plan | Prix | Avantages |
|------|------|-----------|
| OOTD Plus | 2,99€/mois | 20 analyses/jour, badge ⭐, historique complet, personnalité "Styliste bienveillant" |
| OOTD Elite | 4,99€/mois | Analyses illimitées, tous cosmétiques, badge 💎, toutes les personnalités IA |

Détection de tier via `lib/tier.js` (`getSubActive`/`getActivePlan`, partagé avec RecapScreen/AccueilScreen).

**2. Achats Express (Stripe — one-time, 0,99€)**
- Gel de Flamme → `create-payment-session` (product='flame_freeze') — **réactivé fonctionnellement le 2026-09-25** (décision D4) : protège désormais la régularité de soumission **par compétition** (`competition_members.streak_count`/`last_submission_date`) via la RPC `restore_competition_streak`, plutôt que l'ancien streak 1-à-1 disparu avec `FlammesScreen`. Le produit shop lui-même (achat/crédit du gel) est inchangé ; seule la consommation change de cible. Pas encore de bouton UI pour déclencher `restore_competition_streak` — la RPC existe et est vérifiée, le branchement dans `CompetitionScreen` reste à faire.
- Pack 2 000 points → `create-payment-session` (product='points_2000')
- Crédit posé par webhook `stripe-webhook`, jamais ici

**3. Boutique Points**
- Thèmes : Midnight/Émeraude `1 000 pts`, Or Prestige/Sakura `1 500 pts`
- Icônes (badges emoji) : Flamme/Défaut `150 pts`, Diamond/Étoile/Couronne `200 pts`
- Logos App (images réelles) : Bleu Néon/Vert Néon `500 pts`, Sunset `600 pts`, Rose Flashy `650 pts`, Rose Pastel `750 pts`
- Flux : `buy_cosmetic` RPC → `equip_cosmetic` RPC → `refreshTheme()`
- Elite : tout gratuit (Équiper direct)

> **Bug corrigé (2026-09-17)** : une migration antérieure avait accidentellement réécrasé cette grille de prix par une version bien moins chère (250-500 pts) en se basant sur la mauvaise révision. La grille ci-dessus (1000/1500 thèmes, 150-750 logos) est la valeur active corrigée.

**Gels mensuels** : `claim_monthly_freezes()` RPC (Free=1, Elite=2, idempotente par mois).

### CustomizationScreen (`screens/CustomizationScreen.js`)
Modal plein écran post-analyse, appelé depuis AccueilScreen. Props : `visible`, `onClose`, `theme`, `score`, `imageUri`, `caption`, `setCaption`, `selectedMusic`, `setSelectedMusic`, `showStyleHashtag`, `setShowStyleHashtag`, `visibleScores`, `onToggleScore`, **`onContinue`, `continuing`** (remplacent les anciens `onPublish`/`onFlammes`/`onSaveForSelf`/`posting`/`sendingFlammes`/`saving`).
- Résumé scores (chips global /100, fit /33, harmonie /34, détails /33 — dénominateurs dynamiques par `ch.max`)
- TextInput caption (200 chars max)
- Recherche musique Deezer inline, autoplay preview au tap
- Toggle hashtags de style, sélection notes visibles
- **1 seul bouton "Continuer"** → `onContinue()` (voir AccueilScreen Phase 4/5)

---

## Composants réutilisables

### `AppHeader` (`components/AppHeader.js`)
Header custom de l'app. Props : `{ title }` (défaut `'OOTD'`). Affiche le logo actif équipé via `useTheme()`.

### `Bouncy` / `Bouncy.web.js` (`components/Bouncy.js`)
Wrapper de pression tactile réutilisable avec effet d'enfoncement élastique. Variante native (Reanimated) / web (`Animated` classique).

### `HeartOverlay` / `HeartOverlay.web.js` (`components/HeartOverlay.js`)
Cœur overlay animé sur double-tap (Feed). API impérative `ref.play()`.

### `InAppCamera` (`components/InAppCamera.js`)
Modale caméra plein écran custom basée sur `expo-camera`. Props : `visible`, `mode` (`'photo'|'video'`), `onCapture(asset)`, `onClose`. Consommée par `AccueilScreen` (photo de tenue).

### `MediaCropEditor` (`components/MediaCropEditor.js`)
Éditeur de recadrage (photo/vidéo) réutilisable. Consommé par `AccueilScreen` (recadrage de la photo de tenue avant analyse).

### `Skeleton` (`components/Skeleton.js`)
Placeholder de chargement générique (shimmer). Utilisé dans `FeedScreen` et `RecapScreen`.

### `Button` (`components/Button.js`)
Props : `title`, `variant` (primary/secondary/outline), `loading`, `disabled`, `leftIcon`, `rightIcon`, `onPress`

### `Avatar` (`components/Avatar.js`)
Props : `uri`, `size` (défaut 80), `username` (initiale fallback), `loading`, `onPress`, `borderWidth`, `borderColor`. Réutilisé par `FriendsScreen`, `CreateCompetitionScreen`, `CompetitionScreen`, `PalmaresScreen`.

### `FeedCommentsModal` (`components/FeedCommentsModal.js`)
Props : `visible`, `ootdId`, `userId`, `onClose`, `onThreadCount(ootdId, count)`. Charge `comments` joint `profiles(username, avatar_url)`.

### Composants inline (dans les écrans)
- **Gauge** (`components/Gauge.js`) : arc SVG partiel coloré, prop `max` dynamique (label `/max` affiché, plus de `/10` figé) — 3 critères Analyse
- **AnimatedEntrance** : fade + rise + scale à l'apparition
- **AudioMessage**, **TypingDots**, **LikeBadge**, **SwipeableMessageBubble** : composants de bulle de message développés pour l'ancien chat 1-à-1 — le fichier qui les hébergeait (`FlammesScreen.js`) a été supprimé avec la refonte ; `CompetitionScreen.js` réimplémente une bulle de message plus simple en V1 (pas d'audio/swipe-to-reply/typing pour le chat de groupe, ajoutables plus tard)
- **DarkLightToggle** (RecapScreen) : switch animé lune/soleil

> **Supprimés (2026-09) avec la refonte Compétitions** : `screens/FlammesScreen.js`, `screens/ProfilScreen.js` (contenu déplacé dans `RecapScreen.js`), `components/StoryMedia.js`, `components/InAppBanner.js` (orphelin depuis le passage à 3 onglets, jamais rebranché sur `competition_messages` — le badge non-lu par compétition sur Accueil couvre le besoin), `lib/storyActions.js`, `lib/flammesUtils.js` (seule `getLocalDayIsoRange` a survécu, déplacée dans `lib/competitionUtils.js`).

---

## Bibliothèques partagées (`lib/`)

### `lib/tier.js` — détection de tier (Gratuit/Plus/Elite), partagée
- `getSubActive(subscription)` / `getActivePlan(subscription)`
- `resolveTier({ subscription, hasPlus, hasAnalysis })` → `'free'|'plus'|'elite'`
- `PERSONA_TIER`, `DEFAULT_PERSONA` ('coach'), `isPersonaUnlocked(key, tier)`, `tierLabel(tier)` — **DOIT rester synchronisé** avec la copie TS dans `supabase/functions/analyze-outfit/index.ts`

### `lib/supabase.js`
Client unique exporté comme `supabase`. `AsyncStorage` pour persister la session.

### `lib/utils.js`
- `computeNiveau(pts)`, `computeLevelInfo(pts)`, `timeAgo(date)`

> `computeNiveau` est répliquée côté serveur en PL/pgSQL (`compute_niveau(p_pts)`). Toute modification du barème doit être appliquée aux deux endroits.

### `lib/competitionUtils.js` — nouveau (remplace `lib/flammesUtils.js`)
- `getLocalDayIsoRange()` → fenêtre minuit-minuit fuseau local (reprise telle quelle de l'ancien `flammesUtils.js`)
- `hasSubmittedTodayForCompetition(supabase, competitionId, userId)` → équivalent "régularité de participation" qui remplace le streak 1-à-1. `ootd_competitions.user_id`/`created_at` sont dénormalisés depuis `ootds` à l'insert (RPC `submit_ootd_to_competitions`), donc aucune jointure n'est nécessaire ici.

### `lib/pendingOutfit.js` — nouveau
Singleton hors React (même pattern que `lib/activeChat.js`) : porte la tenue déjà uploadée entre `AccueilScreen` et `ShareToCompetitionScreen` (`setPendingOutfit`/`getPendingOutfit`/`clearPendingOutfit`) — évite de sérialiser l'image dans les route params de navigation.

### `lib/activeChat.js`
`setActiveCompetition(competitionId)` / `getActiveCompetition()`. L'équivalent 1-à-1 (`setActiveChat`/`getActiveChat`) a disparu avec `FlammesScreen.js`.

### `lib/competitionFonts.js` — nouveau (2026-09-28)
`useCompetitionFonts()` (charge 'Baloo 2' 700 + 'Plus Jakarta Sans' 400/500/600/700 via `@expo-google-fonts/*`) + constantes `FONT_DISPLAY`/`FONT_BODY.{regular,medium,semibold,bold}`. Utilisé par `CompetitionScreen.js` et `CompetitionsListScreen.js` (seuls écrans à palette fixe/police dédiée, indépendants de `useTheme()`) — voir leur note en tête de fichier.

### `lib/themeContext.js` / `lib/logoConfig.js`
Voir section « Thème et cosmétiques » ci-dessus.

### `lib/downloadImage.js` — `downloadImageToDevice(imageUrl, fileBaseName = 'ootd_outfit')`
Télécharge une image distante vers l'appareil. Utilisé dans `RecapScreen` (lightbox galerie).

### `lib/env.js`
Lit `process.env.EXPO_PUBLIC_*`. `requireEnv(name, value)` lève une erreur si `value` est falsy.

### `lib/ensureProfile.js` — `ensureUserProfile()`
1. `getUser()` → si non authentifié, retourne `{ok:true, skipped:true}`
2. SELECT depuis `profiles` — si absent : INSERT avec username depuis `user_metadata`, `active_logo: 'star'`
3. Retry sur conflit 23505 : `<base>_<uid8>` puis `user_<uid8>`

### `lib/notifications.js`
- `registerForPushNotifications()`, `savePushToken(token)` (→ `profiles_private`)
- **`scheduleDailyReminder(hour, minute)`** (renommé depuis `scheduleFlammeReminder` le 2026-09-24, copie reformulée pour les compétitions : "C'est l'heure de prendre ta photo du jour pour tes compétitions ! 🏆") : notif locale quotidienne (19h par défaut), natif uniquement
- `sendPushNotification(token, title, body)` : Expo Push API

### `lib/toastContext.js` — `ToastProvider` + `useToast()`
`useToast()` retourne `{ showToast, dismissToast, toasts }` — **toujours destructurer**. Types : `info`/`success`/`warning`/`error`.

### `lib/haptics.js`
`triggerHaptic(duration)` : `Vibration` (natif) ou `navigator.vibrate` (PWA)

### `lib/pwa.js` (natif — stub) / `lib/pwa.web.js` (implémentation réelle)
`setupPwa()`, `isPwaStandalone()`, `canInstallPwa()`/`promptInstall()`, `requestWebNotificationPermission()`

### `lib/webPush.js` (natif — stub) / `lib/webPush.web.js` (implémentation réelle)
`registerWebPush()`, `unsubscribeWebPush()`, `dismissChatNotifications()`

---

## Edge Functions Supabase

### `analyze-outfit`
| Clé | Valeur |
|-----|--------|
| Méthode | POST |
| Auth | JWT obligatoire |
| Rate-limit | 5 req/min (`check_analyze_rate_limit` RPC) |
| Entrée | `{ base64Image: "data:image/jpeg;base64,...", personality?: "fashion_week"\|"bienveillant"\|"pote_hype"\|"coach"\|"streetwear" }` |
| Sortie (photo complète) | `{ global, fit, harmonie, detail, explications: {fit, harmonie, detail}, conseil, styles: string[], credits_remaining, max_credits, provider }` |
| Sortie (photo incomplète) | `{ photo_complete: false, raison_incomplete: string, provider }` — aucun crédit consommé |

**Note sur 100 (v3, 2026-09-24)** — remplace l'ancienne note sur 10 :
- Trois sous-critères qui **s'additionnent** directement (plus de moyenne) : `couleurs_note` (harmonie, 0-34), `coupe_note` (fit, 0-33), `style_note` (detail, 0-33) → `global = harmonie + fit + detail`, 0-100.
- **Vérification préalable "photo complète"** : si la photo ne montre pas la tenue des épaules aux genoux minimum, `photo_complete: false` et aucune note n'est calculée — condition d'équité pour comparer les scores entre utilisateurs dans un classement. Dans ce cas, **`consume_daily_credit` n'est PAS appelé** (le crédit n'est consommé qu'après confirmation que la photo est notable) — changement d'ordre du flux par rapport à avant (auth → persona → rate-limit → **appel IA → parsing → branche photo_complete** → crédit → réponse), qui a aussi pour effet positif secondaire qu'un JSON malformé ne brûle plus de crédit non plus.
- **Calibrage explicite dans le prompt** : chaque critère part d'un **point de départ représentant une tenue neutre et correcte** (24/34, 23/33, 20/33 = 67/100 de base), ajusté à la hausse/baisse selon ce qui est réellement observé — pas un départ à 0 ou au max avec seulement des additions/soustractions. Un paragraphe de calibrage explicite indique à l'IA qu'une tenue correcte doit obtenir ~65-70/100. **Historique** : la première version du prompt v3 faisait partir 2 des 3 critères de 0 en ne faisant qu'additionner des points — un modèle vision-langage est structurellement conservateur sur ce type d'ajout ouvert, ce qui écrasait systématiquement la note globale (retours réels : jamais au-dessus de 17/100 sur des tenues pourtant correctes). Corrigé le 2026-09-24.
- `award_points_for_ootd` recalibré en conséquence (`points_earned = ROUND(score_global * 0.3)`, plafond de points par publication inchangé : 100×0.3 = 30, identique à l'ancien 10×3).
- `ootds.score_scale` (smallint, défaut 100) marque l'échelle de chaque ligne — les lignes antérieures à cette migration sont à `10`, ce qui permet à l'UI (lightbox `RecapScreen`) d'afficher le bon dénominateur et à un futur écran de progression "tout temps" de normaliser avant de moyenner (`RecapScreen.moyenneScore` le fait déjà : `(score_global / score_scale) * 100`).

**Providers** (avec fallback automatique) :
1. Google Gemini 2.5-flash (THINKING_BUDGET=0, max 1500 tokens, `responseMimeType: 'application/json'`)
2. Groq Llama 4 Scout 17B vision (fallback si Gemini KO)

**Personnalité du critique IA** (`personality`) : clé fermée uniquement, n'affecte que le ton (jamais le barème). Gating par tier (`coach`=Gratuit, `bienveillant`=Plus, `pote_hype`/`fashion_week`/`streetwear`=Elite), vérifié côté serveur.

**Secrets** : `GEMINI_API_KEY`, `GROQ_API_KEY`, `APP_ORIGIN`

> ⚠️ **Déploiement self-host** : sur `supabase.myback.fr`, les Edge Functions ne se redéploient PAS automatiquement au `git push` — le code doit être retéléchargé manuellement depuis GitHub (`raw.githubusercontent.com/OOTD-Appli/outfit-of-the-day/main/supabase/functions/<nom>/index.ts`) dans le volume bind-mounté du serveur, puis `docker compose up -d functions`. Toujours vérifier que cette synchro a bien eu lieu après une modification de prompt/logique serveur avant de conclure à un bug de code.

### `deezer-search`
Proxy CORS-safe vers `api.deezer.com/search`. Auth optionnelle (`--no-verify-jwt`). **Secrets** : `APP_ORIGIN`

### `create-checkout-session`
Mode `subscription`, `{ plan_type: 'plus'|'elite' }` → `{ url }`. **Secrets** : `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_ELITE`, `APP_REDIRECT_URL`, `APP_ORIGIN`

### `create-payment-session`
Mode `payment` (one-time), `{ product: 'flame_freeze'|'points_2000' }` → `{ url }`. Crédit posé par `stripe-webhook`. **Secrets** : `STRIPE_SECRET_KEY`, `STRIPE_PRICE_FLAME_FREEZE`, `STRIPE_PRICE_POINTS_2000`, `APP_REDIRECT_URL`, `APP_ORIGIN`

### `create-portal-session`
Ouvre le Customer Portal Stripe. **Secrets** : `STRIPE_SECRET_KEY`, `APP_REDIRECT_URL`, `APP_ORIGIN`

### `stripe-webhook`
Signature Stripe (`whsec_...`) — déployer `--no-verify-jwt`. Événements : `checkout.session.completed` (mode=payment) → `apply_one_time_purchase` ; `customer.subscription.created/updated/deleted` → `apply_subscription_change`. **Secrets** : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

### `send-web-push`
`{ recipient_id, title, body, url, tag? }` → `{ sent, removed }`. Vérifie amitié acceptée. **Secrets** : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `APP_ORIGIN`

> **CORS** : toutes les Edge Functions lisent `APP_ORIGIN` (`Deno.env.get('APP_ORIGIN') ?? '*'`).

---

## Fonctions PostgreSQL (RPCs)

### Trigger `profiles_guard_sensitive_trigger`
`BEFORE UPDATE` sur `profiles`. Colonnes protégées : `points`, `niveau`, `has_analysis_pass`, `has_ootd_plus_pass`, `daily_credits`, `credits_reset_date`, `unlocked_themes`, `unlocked_logos`, `active_theme`, `active_logo`, `flame_freezes`, `last_freeze_grant`. RPCs SECURITY DEFINER contournent via `set_config('app.bypass_profile_guard', 'on', true)`.

### `compute_niveau(p_pts integer)` — IMMUTABLE
Miroir JS de `lib/utils.js#computeNiveau`.

### `consume_daily_credit(p_user_id)` / `check_analyze_rate_limit(p_max_per_minute)` — SECURITY DEFINER
Appelées par `analyze-outfit` uniquement désormais (`contextual-analysis` a disparu). Ordre : rate-limit avant crédit, et crédit consommé seulement après confirmation `photo_complete !== false` (voir Edge Function ci-dessus).

### `award_points_for_ootd(p_ootd_id)` — SECURITY DEFINER
Lit `score_global` (clampe 0–100 depuis 2026-09-24, `points_earned = ROUND(score * 0.3)`), met à jour `points`/`niveau`. Appelée par `submit_ootd_to_competitions`.

### `increment_style_stats(p_styles text[])` — SECURITY DEFINER
Incrémente `profiles.style_stats` (jsonb). Appelée par `submit_ootd_to_competitions`.

### `buy_cosmetic(item_type, item_id)` / `equip_cosmetic(item_type, item_id)` — SECURITY DEFINER
Voir ShopScreen ci-dessus pour la grille de prix corrigée (2026-09-17).

### `restore_flamme(p_flamme_id)` / `claim_monthly_freezes()` — SECURITY DEFINER
Inchangées. `flammes`/`snaps` restent en base (non purgées) mais plus aucun code client n'écrit dedans depuis la refonte Compétitions.

### `restore_competition_streak(p_competition_id)` — SECURITY DEFINER (nouveau, 2026-09-25)
Équivalent de `restore_flamme` pour le streak par compétition (décision D4). Restaure uniquement un oubli d'**exactement** 1 jour (`last_submission_date = aujourd'hui - 2`), consomme 1 `flame_freezes` (même contournement `app.bypass_profile_guard` que `restore_flamme`/`claim_monthly_freezes`), ne touche pas `streak_count` — seule la "couverture" de la veille est restaurée, le compteur reprend sa progression normale à la prochaine soumission.

### `apply_one_time_purchase(...)` / `apply_subscription_change(...)` — SECURITY DEFINER / `service_role`
Inchangées, voir `stripe-webhook`.

### Compétitions — nouvelles RPCs (2026-09)

| RPC | Rôle |
|---|---|
| `create_competition(p_name)` | Crée une compétition + y ajoute son créateur. Supersedée en pratique par `create_competition_with_members` (créée après, voir ci-dessous) mais toujours présente/fonctionnelle. |
| `create_competition_with_members(p_name, p_member_ids[])` | Crée une compétition + ajoute le créateur + chaque membre proposé, **après avoir vérifié que chacun est un ami accepté** (`friendships`). Utilisée par `CreateCompetitionScreen`. |
| `create_competition_invite(p_competition_id, p_max_uses?, p_expires_in_days=7)` | N'importe quel membre peut générer un lien (token aléatoire 16 octets hex). |
| `get_competition_invite_preview(p_token)` | Lecture seule, **accessible sans compte** (`GRANT ... TO anon, authenticated`) — aperçu nom + nombre de membres avant de rejoindre. |
| `redeem_competition_invite(p_token)` | Authentification requise. Idempotent (`already_member: true` si déjà membre). Toujours précédé d'un écran de confirmation côté client — jamais d'adhésion automatique au clic. **2026-09-29** : n'accepte plus que les amis acceptés (`friendships`) du créateur du lien (`created_by`) — faille corrigée lors de l'audit des règles métier Compétitions v2 (n'importe qui avec le lien pouvait rejoindre auparavant). |
| `revoke_competition_invite(p_token)` | N'importe quel membre peut révoquer un lien. |
| `leave_competition(p_competition_id)` — nouveau (2026-09-29) | N'importe quel membre (y compris le créateur) peut quitter. Si le créateur quitte, la compétition continue d'exister pour les autres (`created_by` inchangé) — `delete_competition` reste utilisable par l'ex-créateur ensuite. |
| `delete_competition(p_competition_id)` — nouveau (2026-09-29) | Réservé au créateur (vérifié sur `created_by`, pas sur l'appartenance actuelle). Cascade déjà en place sur toutes les FK (`competition_members`, `ootd_competitions`, `competition_messages`, `competition_invites`, `competition_message_likes`/`reactions`) — un simple `DELETE FROM competitions` nettoie tout. |
| `submit_ootd_to_competitions(...)` | RPC atomique de publication (voir AccueilScreen Phase 5). Vérifie l'appartenance à **toutes** les compétitions ciblées avant d'insérer quoi que ce soit. `p_score_global` est un paramètre explicite passé par le client (pas recalculé en somme/moyenne dans la RPC) — le calcul du score reste la responsabilité de `analyze-outfit`. |
| `delete_competition_message(p_id)` | Soft-delete, expéditeur uniquement, même pattern que l'ancien `delete_message`. |
| `mark_competition_read(p_competition_id)` | Met à jour `competition_members.last_read_at` pour le membre courant. |
| `toggle_competition_message_like(p_message_id)` — nouveau (2026-09-27) | Like/unlike atomique sur un message de chat (plusieurs personnes peuvent liker). Retourne `{ok, liked, like_count}`. Écriture RPC uniquement (pas de policy INSERT/DELETE directe sur `competition_message_likes`, sinon un membre pourrait liker au nom d'un autre `user_id`). |
| `add_competition_message_reaction(p_message_id, p_emoji)` — nouveau (2026-09-27) | Ajoute une réaction emoji (whitelist fermée de 5 emoji, verrouillée aussi par une `CHECK` constraint sur `competition_message_reactions`). Idempotent (`ON CONFLICT DO NOTHING`), ajout uniquement en V1 — pas de RPC de retrait. |
| `get_top3_app(p_period text DEFAULT 'week')` | Classement groupé par utilisateur, filtré `is_public=true` et `profiles.is_private=false`. **Période paramétrable depuis 2026-09-25** (décision D5) : `'day'\|'week'\|'month'\|'all'`, défaut `'week'`. **2026-09-30** : `MAX(score_global)` gardé seulement pour `'day'` (record du jour) ; les 3 autres périodes utilisent `ROUND(AVG(score_global),1)` (régularité). Colonne de sortie renommée `best_score` → `score` (nécessite un `DROP FUNCTION` avant le `CREATE OR REPLACE`, Postgres refusant de changer les colonnes d'un `RETURNS TABLE` existant). |
| `get_top3_friends(p_period text DEFAULT 'week')` | Même requête/paramétrage (y compris le changement MAX/AVG et le renommage `score` du 2026-09-30), filtrée sur les amis acceptés (`friendships`) de l'appelant — **indépendant de l'appartenance à une compétition commune** (décision produit explicite). |
| `get_competition_leaderboard(p_competition_id, p_period text DEFAULT 'week')` — nouveau (2026-09-25, D1/D3/D5) | Classement complet d'**une** compétition (pas seulement un Top 3 global) + 3 blocs secondaires. Revérifie elle-même l'appartenance en premier (`SECURITY DEFINER` contourne le RLS, donc `{ok:false,error:'Non membre'}` sinon — sans ça n'importe quel utilisateur authentifié pourrait lire le classement de n'importe quelle compétition en devinant son id). Retour : `{ok, ranking:[{user_id,username,avatar_url,score,streak_count}], most_regular, most_improved, most_liked}` (les 3 derniers `null` si personne ne qualifie). **2026-09-30** : `score` = `MAX(score_global)` pour `'day'`, `ROUND(AVG(score_global),1)` pour les 3 autres périodes (clé jsonb renommée depuis `best_score`, pas de `DROP` nécessaire — retour `jsonb` opaque). |
| `is_competition_member(p_competition_id)` — STABLE SECURITY DEFINER | Helper interne qui casse la récursion RLS (voir Post-mortems) — utilisé par toutes les policies "membre de cette compétition", pas destiné à être appelé directement par le client. |

---

## Schéma de base de données

### `profiles`
Inchangé depuis la dernière version (voir colonnes ci-dessous), pas de nouvelle colonne liée aux compétitions — l'appartenance vit dans `competition_members`.

| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | = auth.users.id |
| username | text UNIQUE NOT NULL | |
| avatar_url | text | URL publique bucket `avatars` |
| points, niveau, daily_credits, credits_reset_date | | Via RPC uniquement |
| has_analysis_pass, has_ootd_plus_pass | boolean | Pass legacy |
| flame_freezes, last_freeze_grant | | Via RPC uniquement |
| unlocked_themes, unlocked_logos, active_theme, active_logo | | |
| is_private | boolean DEFAULT false | |
| bio | text | max 160 chars |
| style_stats | jsonb DEFAULT '{}' | |
| specialized_feed | boolean DEFAULT false | |
| analysis_personality | text DEFAULT 'coach' | |
| created_at | timestamptz | |

> `user_metadata.dark_mode` (Supabase Auth, hors table) stocke dark/light cross-device.

### `profiles_private`
`id` (=auth.users.id), `push_token`. RLS owner-only.

### `ootds`
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| user_id | uuid | → auth.users |
| image_url | text NOT NULL | |
| score_global / score_couleurs / score_coupe / score_tendance | numeric | Voir mapping IA plus haut |
| **score_scale** | smallint DEFAULT 100 | **Nouveau (2026-09-24)** : 100 pour les lignes notées avec le prompt v3, 10 pour les lignes antérieures (backfillées). |
| conseil, caption | text | |
| audio_title/artist/preview_url/cover_url | text | Musique Deezer |
| is_public | boolean DEFAULT true | Indépendant de l'appartenance à une compétition — gère uniquement l'apparition dans le Feed |
| styles | text[] DEFAULT '{}' | |
| show_style_hashtag | boolean DEFAULT true | |
| visible_scores | text[] DEFAULT '{}' | |
| created_at | timestamptz | |

Une tenue est reliée à 0, 1 ou plusieurs compétitions via `ootd_competitions` (many-to-many), en plus/indépendamment de `is_public`.

### `competitions` — nouveau
`id` PK, `name` (1-60 car.), `created_by` → auth.users, `created_at`. RLS : visible aux membres uniquement (via `is_competition_member`). Pas de policy INSERT directe — création via `create_competition`/`create_competition_with_members` uniquement.

### `competition_members` — nouveau
PK composite `(competition_id, user_id)`, `joined_at`, `last_read_at` (curseur non-lu). `user_id` → **profiles(id)** (⚠️ corrigé le 2026-09-28 : référençait `auth.users(id)` depuis la création de la table, voir Post-mortems). RLS SELECT membres uniquement, DELETE self (quitter une compétition). **Pas de policy INSERT** — rejoindre uniquement via les RPCs (sinon n'importe qui pourrait s'auto-ajouter à n'importe quelle compétition).

**Streak par compétition** (colonnes ajoutées 2026-09-25, décision D4) : `streak_count integer DEFAULT 0`, `last_submission_date date`. Maintenues par `submit_ootd_to_competitions` (jour consécutif → `+1`, trou ≥2 jours ou jamais soumis → reset à 1, déjà soumis aujourd'hui → idempotent), restaurables via `restore_competition_streak` (voir RPCs). Remplace l'ancien streak "flammes" 1-à-1 comme cible fonctionnelle du Gel de Flamme.

### `ootd_competitions` — nouveau
Table d'association `ootd_id` × `competition_id`, PK composite. **Dénormalise `user_id` et `created_at`** depuis `ootds` (posés à l'insert) pour que `hasSubmittedTodayForCompetition` n'ait besoin d'aucune jointure. RLS : SELECT membres, INSERT si propriétaire de l'ootd ET membre de la compétition ciblée (policy directe, pas de RPC nécessaire), DELETE self (unshare).

### `competition_invites` — nouveau
`token` PK (hex 16 octets), `competition_id`, `created_by`, `expires_at` (défaut +7j), `max_uses` (NULL=illimité), `use_count`, `revoked_at`. RLS SELECT membres uniquement — la lecture "publique" (aperçu avant adhésion) passe par la RPC `get_competition_invite_preview`, pas par une policy SELECT directe.

### `competition_messages` — nouveau (remplace `messages` pour le contexte compétition)
| Colonne | Type | Notes |
|---------|------|-------|
| id | uuid PK | |
| competition_id | uuid → competitions | |
| sender_id | uuid → **profiles(id)** | ⚠️ pas `auth.users` — nécessaire pour l'embed PostgREST `profiles(...)`, voir Post-mortems |
| content, image_url | text | nullable, au moins un des deux (ou `is_deleted`) |
| created_at | timestamptz | |
| is_deleted | boolean DEFAULT false | Soft delete |
| **reply_to_id** | uuid → competition_messages(id), nullable | **Nouveau (2026-09-27)** : réponse à un autre message (swipe-to-reply). Résolu dynamiquement côté client depuis les messages déjà chargés — jamais dupliqué en dur. |
| **quoted_label** | text, nullable | **Nouveau (2026-09-27)** : citation en texte plat pour "répondre à une tenue" depuis le viewer plein écran (pas de message existant à cibler dans ce cas → pas de `reply_to_id` possible). Mutuellement exclusif avec `reply_to_id`. |

RLS : SELECT/INSERT membres uniquement (`is_competition_member`). Realtime activé (`REPLICA IDENTITY FULL` + publication `supabase_realtime`).

### `competition_message_likes` / `competition_message_reactions` — nouveau (2026-09-27)
`competition_message_likes(message_id, user_id, created_at)`, PK `(message_id, user_id)` — un like par personne par message, compteur agrégé côté client. `competition_message_reactions(message_id, user_id, emoji, created_at)`, PK `(message_id, user_id, emoji)`, `CHECK (emoji IN ('😂','🔥','❤️','😮','👍'))` — whitelist fermée verrouillée aussi côté DB. RLS : SELECT membres de la compétition du message (via `is_competition_member`), **aucune policy INSERT/UPDATE/DELETE directe** — écriture uniquement via `toggle_competition_message_like`/`add_competition_message_reaction` (sinon un membre pourrait écrire au nom d'un autre `user_id`).

### `likes`, `comments`, `friendships`, `flammes`, `snaps`, `subscriptions`, `web_push_subscriptions`, `analyze_rate_limit`
Inchangées structurellement. `friendships` reste actif (Top 3 amis, sélection de membres). `flammes`/`snaps` restent en base (non purgées) mais plus aucun code client n'écrit dedans.

### `stories` — **supprimée** (2026-09-22)
Table, bucket Storage, trigger de nettoyage et job pg_cron `cleanup-expired-stories` tous purgés. 15 fichiers orphelins (jamais nettoyés car les lignes DB avaient déjà expiré/disparu avant la purge) supprimés via l'API Storage avant le `DROP TABLE` — voir Post-mortems pour pourquoi ça n'a pas pu se faire en SQL direct.

---

## Politiques RLS (résumé)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| profiles | tous auth | soi (trigger annule colonnes sensibles) | soi (trigger) | — |
| profiles_private | soi | soi | soi | — |
| ootds | auth + is_private/ami | soi | — | soi |
| likes / comments | tous auth | soi | — | soi |
| friendships | impliqué | demandeur (`pending`) | destinataire (`pending→accepted/declined`) | les deux |
| flammes / snaps | impliqué | — (plus écrit) | — | — |
| messages | impliqué | sender + amitié acceptée | — | sender |
| subscriptions | soi | — | — | — |
| web_push_subscriptions | soi | soi | — | soi |
| analyze_rate_limit | (aucune) | (aucune) | (aucune) | (aucune) |
| **competitions** | membre (`is_competition_member`) | — (RPC uniquement) | — | — |
| **competition_members** | membre | — (RPC uniquement) | — | soi (quitter) |
| **ootd_competitions** | membre | propriétaire ootd + membre | — | soi |
| **competition_invites** | membre | — (RPC uniquement) | — | — (révocation via RPC) |
| **competition_messages** | membre | sender + membre | — (RPC pour soft-delete) | — |
| **competition_message_likes** | membre (via message→compétition) | — (RPC uniquement) | — | — (RPC toggle) |
| **competition_message_reactions** | membre (via message→compétition) | — (RPC uniquement) | — | — |

---

## Storage Supabase

| Bucket | Visibilité | Politique INSERT | Chemins |
|--------|-----------|-----------------|---------|
| `avatars` | Public | `<uid>/…` uniquement | `<uid>/avatar.jpg` |
| `ootds` | Public | `<uid>/…` ou `ootds/messages/<uid>/…` ou `ootds/audio/<uid>/…` | `<uid>/outfit_<ts>.{jpg,webp}` · `messages/<uid>/<ts>.jpg` · `audio/<uid>/<ts>.{webm,m4a}` |

> Le bucket `stories` a été supprimé (2026-09-22) avec la table du même nom.

---

## Système de crédits et tiers

| Tier | Condition | Analyses/jour | Gels/mois |
|------|-----------|---------------|-----------|
| Gratuit | — | 2 | 1 |
| Plus | Stripe sub `plus` | 20 | 1 |
| Elite | Stripe sub `elite` | ∞ | 2 |
| Pass legacy | `has_analysis_pass` ou `has_ootd_plus_pass` | 20 | 1 |

Rate-limit indépendant : 5 req/min par user (table `analyze_rate_limit`), désormais utilisé uniquement par `analyze-outfit`.

---

## Design responsive

| Élément | Formule |
|---------|---------|
| Score ring (Accueil) | `Math.min(Math.round(screenWidth × 0.22), 96)` |
| Logo (Auth) | `Math.min(Math.round(screenHeight × 0.17), 140)` |
| Avatar (Récap) | `Math.min(Math.round(screenWidth × 0.22), 90)` |
| Photo galerie (Récap) | `padding: 3` par cellule + bordure `1.5px` sur la photo |

---

## Configuration Expo / EAS

### `app.json`
- Bundle ID iOS : `com.medifreymann.ootd`, Package Android : `com.medifreymann.ootd`
- EAS project ID : `4efa34fb-675c-4892-a67a-44f6d1b4d759`
- `scheme: "ootd"` (deep links Stripe : `ootd://shop`)
- Permission Android : `POST_NOTIFICATIONS`, iOS background modes : `remote-notification`
- Plugin expo-notifications : couleur `#ED93B1`, canal `default`
- Plugin expo-media-library : message de permission FR
- **Pas de plugin `expo-camera` déclaré** malgré l'usage de `InAppCamera` — messages de permission caméra/micro iOS par défaut en anglais, pas de texte FR custom (point d'attention non résolu, voir plus bas)

### `eas.json`
- `preview` : Android APK (test) · `production` : Android AAB + iOS (stores)
- `appVersionSource: "remote"`

---

## Infrastructure de production

- **Backend** : Supabase **self-hosted** sur `supabase.myback.fr` (stack officielle `supabase/supabase` docker-compose) — migré depuis Supabase Cloud le 2026-08-12 (voir `docs/MIGRATION_SUPABASE_SELFHOST.md`). Migrations appliquées via `supabase db push --db-url ... --yes` (`PGSSLMODE=disable`, le port 5432 exposé route vers Supavisor, utilisateur `postgres.your-tenant-id`).
- **Edge Functions** : déployées via bind-mount + téléchargement manuel depuis GitHub (pas de `supabase functions deploy` classique sur ce self-host) — **ne se resynchronisent jamais automatiquement au `git push`**, voir avertissement dans la section Edge Functions.
- **Web/PWA** : Vercel, projet `outfit-of-the-day` (⚠️ pas `ootd-fr` malgré le nom de domaine `ootd-fr.vercel.app`), déployé via `vercel --prod`.
- **Paiements** : Stripe en mode **Live** depuis 2026-08-19.

---

## Post-mortems (bugs réels rencontrés et corrigés)

Section volontairement conservée : ces pièges sont faciles à reproduire en ajoutant une nouvelle table/écran sur le même modèle.

- **Récursion RLS infinie** (2026-09-24) : une policy sur `competition_members` vérifiait l'appartenance en réinterrogeant `competition_members` elle-même dans un `EXISTS` — chaque lecture de la table redéclenche sa propre policy à l'infini (`infinite recursion detected in policy for relation "competition_members"`). **Toujours** déporter ce genre de vérification dans une fonction `STABLE SECURITY DEFINER` (son propriétaire, `postgres`, n'est pas soumis au RLS de ses propres tables) plutôt qu'un `EXISTS` direct sur la même table que celle portant la policy.
- **FK vers `auth.users` au lieu de `profiles`** : `competition_messages.sender_id` référençait `auth.users(id)`, un schéma que PostgREST ne peut pas utiliser pour résoudre un embed `profiles(...)` dans un `.select()` (`Could not find a relationship between 'competition_messages' and 'profiles'`). **Toute colonne destinée à être embed-jointe avec `profiles` dans une requête client doit référencer `profiles(id)`, jamais `auth.users(id)`** — même piège déjà rencontré sur `ootds`/`likes`/`friendships`/`flammes`/`snaps` lors de la migration self-host (corrigé alors en direct sur le Cloud d'origine ; raté sur les tables Compétitions car nouvelles).
- **Même piège FK, une 2e fois, raté malgré la note ci-dessus** (2026-09-28) : `competition_members.user_id` référençait lui aussi `auth.users(id)` au lieu de `profiles(id)` — passé inaperçu depuis la création de la table car aucun code n'avait eu besoin d'embed `profiles(...)` depuis `competition_members` jusqu'au carrousel "tenues du jour" de l'écran Compétition v4. **Détail piégeux supplémentaire** : invisible via `information_schema.constraint_column_usage` sur ce self-host (la vue ne résout pas fiablement les cibles cross-schema ici) — la FK semblait ne pas exister du tout dans ce diagnostic, alors qu'elle existait bel et bien (vers `auth.users`). Toujours confirmer la cible réelle d'une FK suspecte via `pg_constraint`/`pg_get_constraintdef(oid)` directement, pas seulement `information_schema`.
- **Ambiguïté d'embed PostgREST introduite en ajoutant une table de likes/réactions** (2026-09-28, `PGRST201` "more than one relationship was found") : dès que 2 tables (`competition_message_likes`, `competition_message_reactions`) ont chacune une FK vers la table A (`competition_messages`) ET vers la table B (`profiles`), PostgREST les traite comme des jonctions many-to-many *candidates* entre A et B — un embed nu `profiles(...)` sur `competition_messages` devient ambigu (3 chemins : direct via `sender_id`, ou indirect via chacune des 2 tables de jonction), même si la requête ne demande jamais d'embed `profiles(...)` DANS ces tables de jonction elles-mêmes. **Dès qu'une nouvelle table de jonction est ajoutée entre deux tables déjà reliées par une FK directe, il faut désambiguïser l'embed existant avec un hint explicite** : `profiles!competition_messages_sender_id_fkey(...)` plutôt que `profiles(...)`. Repérable en reproduisant l'appel exact via `curl` sur `/rest/v1/<table>?select=...` (renvoie le JSON d'erreur `PGRST201` avec la liste des relations candidates et un `hint` suggérant la syntaxe corrigée).
- **Mauvaise syntaxe de tri sur une ressource imbriquée** : `.order('competitions(created_at)', { ascending: false })` n'est *pas* la syntaxe supabase-js pour trier par une colonne d'une table jointe — elle échoue silencieusement (ou en toast d'erreur visible selon l'écran). La bonne syntaxe : `.order('created_at', { foreignTable: 'competitions', ascending: false })`.
- **`DELETE FROM storage.objects` refusé en SQL brut** sur le self-host (`ERROR 42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.`) — la suppression de fichiers Storage doit passer par l'API HTTP (`storage/v1/object/list` puis `.remove()`/`DELETE /storage/v1/bucket/<name>`), jamais par une migration SQL.
- **Prompt de notation IA qui écrase les scores vers le bas** : faire partir un critère à 0 en ne prévoyant que des additions produit des notes anormalement basses (un modèle vision-langage est conservateur sur ce type d'ajout ouvert). Toujours donner un **point de départ réaliste** (~65-70% du barème) représentant le cas "correct et neutre", ajustable dans les deux sens.
