# Suivi des tâches — OOTD

> Dernière mise à jour : 2026-05-29 — Garbage collector stories + compression images/vidéos + migration GC.

---

## Sécurité — Audit 2026-05-28

### 🔴 CRITIQUES

- [x] **SEC-01 — Trigger protection colonnes sensibles `profiles`** : trigger `BEFORE UPDATE` qui bloque toute modification directe de `points`, `niveau`, `has_*_pass`, `daily_credits`, `credits_reset_date`, `unlocked_*`, `active_theme`, `active_logo` depuis le client. Seules les fonctions `SECURITY DEFINER` peuvent les modifier via le flag `app.bypass_profile_guard`. Migration `20260528100000_security_hardening.sql`.
- [x] **SEC-02 — Points/niveau non falsifiables** : RPC `award_points_for_ootd(ootd_id)` SECURITY DEFINER — lit le score réel depuis la DB, calcule et attribue les points côté serveur. `AccueilScreen.publishToFeed` remplacé pour appeler ce RPC.
- [x] **SEC-03 — Streaks non manipulables** : trigger + RPC protect; le score de streaks ne peut plus être modifié directement par le client (colonnes `flammes.streak` et `last_snap_at` non dans le trigger profiles, mais la règle "1 snap/jour" est renforcée côté RLS snaps — cf. SEC-05).
- [x] **SEC-04 — Amitié forgée impossible** : policies `friendships` scindées par direction : `INSERT` = demandeur seulement (`user_id = uid AND status = 'pending'`), `UPDATE` = destinataire seulement (`friend_id = uid AND status IN ('accepted','declined')`), `DELETE` = les deux.
- [x] **SEC-05 — Spam messages/snaps à inconnus** : check d'amitié acceptée ajouté dans les policies `INSERT` de `messages` et `snaps`. Impossible d'envoyer à quelqu'un qui n'est pas ami.
- [x] **SEC-06 — Storage stories : upload sur chemin d'autrui** : policy `Authenticated can upload stories` corrigée pour exiger `split_part(name,'/',1) = uid` (même contrainte que pour `avatars` et `ootds`).

### 🟠 ÉLEVÉS

- [x] **SEC-07 — Monétisation via RPC** : `buyPass` → `buy_pass(pass_type)`, `buyItem` → `buy_cosmetic(item_type, item_id)`, `equipItem` → `equip_cosmetic(item_type, item_id)`. Les RPCs SECURITY DEFINER valident les points, l'ownership et les IDs; le client ne peut plus s'auto-attribuer passes ou cosmétiques.
- [x] **SEC-08 — Stories visibles uniquement par amis** : policy `stories_select_friends_only` — expire_at > now() ET (own story OR friendship accepted).
- [ ] **SEC-09 — Validation `image_url` (ootds/messages)** : ajouter une contrainte `CHECK (image_url ~ '^https://.*\.supabase\.co/storage/')` sur `ootds.image_url` et `messages.image_url`. **À faire manuellement dans SQL Editor Supabase** (risque de casser des données existantes si les URLs ne matchent pas).
- [ ] **SEC-10 — Limites taille/type sur buckets Storage** : configurer `file_size_limit` et `allowed_mime_types` sur les buckets `avatars` (5 Mo, image/*), `ootds` (10 Mo, image/*), `stories` (100 Mo, video/mp4). **À faire dans Supabase Dashboard > Storage > Edit bucket**.

### 🟡 MOYENS

- [x] **SEC-11 — Validation `base64Image` dans l'Edge Function** : vérification longueur max 10 Mo + MIME prefix valide (jpeg/png/webp). `supabase/functions/analyze-outfit/index.ts`.
- [x] **SEC-12 — `alert()` dans `notifications.js`** : remplacé par `console.warn` (évite crash sur certains contextes RN).
- [x] **SEC-13 — Logs sensibles supprimés** : `console.log('[publishStory] url publique:')` retiré de `FlammesScreen.js`.
- [ ] **SEC-14 — Fuite `push_token` via `profiles SELECT`** : `profiles_select_authenticated USING (true)` expose les push_tokens de tous les utilisateurs à tout utilisateur authentifié. **Fix complet** : créer table `profiles_private(id, push_token)` avec policy `id = uid`, migrer les lectures/écritures. Laisser `profiles` sans push_token. **Travail important, à planifier**.
- [ ] **SEC-15 — CORS `*` sur l'Edge Function** : remplacer `'Access-Control-Allow-Origin': '*'` par l'origine de l'app. Faible impact sans cookies, mais bonne hygiène.
- [ ] **SEC-16 — Rate-limit applicatif Edge Function** : en complément du `consume_daily_credit`, ajouter une table `analyze_rate_limit` (uid, window_1min, count) pour limiter les appels même si les crédits sont manipulés.

---

## À faire (reste de ton côté)

~~### [PRIORITÉ HAUTE] Évolution de l'UI et des Interactions du Feed (Accueil)~~
- **Référence visuelle stricte** : la maquette `StyleAppliAccueil.png` (`C:\Users\medif\Downloads\`) fait foi pour le style, l'ordre et l'alignement des 4 boutons — aucun écart accepté.
- **Colonne d'actions droite** (verticale, côté droit de l'écran, de haut en bas) :
  1. **Avatar + badge "+"** (ajout rapide) : affiche l'avatar de l'auteur du post avec un cercle rose `+` en badge bas-droit. Tap → envoie une demande d'ami à l'auteur (appel `sendFriendRequest` via la logique existante de `FlammesScreen`). Si déjà amis : badge check vert à la place du `+`.
  2. **Cœur 🤍 / ❤️** avec compteur : fonctionnalité like existante — conserver sans changement.
  3. **Bulle commentaire 💬** avec compteur : fonctionnalité commentaire existante — conserver sans changement.
  4. **Flèche envoi ➤** avec compteur : remplacer le `Share.share()` natif par une modale ou un `ActionSheet` listant les conversations Chat de l'utilisateur (amis acceptés). Tap sur un ami → insert un message dans la table `messages` avec `image_url` du post et un texte court ("a partagé une tenue"). Incrémenter le compteur local à l'affichage.
  5. **"…"** (trois points) : garder ou ajouter en bas de la colonne pour les options supplémentaires.
- **Style des boutons** : icônes blancs (non remplis), taille ~28–30px, compteurs en blanc sous chaque icône, ombre portée légère pour lisibilité sur photo. Espacement vertical régulier entre chaque bouton (~20px gap). Position : `right: 12`, à partir du bas de l'écran.
- **Fichiers concernés** : `screens/FeedScreen.js` (rendu `sideActions`, `toggleLike`, `onSharePress`), `lib/flammesUtils.js` ou appel direct Supabase pour la demande d'ami.
- **Migration SQL éventuelle** : si un compteur de partages (`shares_count`) est ajouté à la table `ootds`, prévoir `ALTER TABLE ootds ADD COLUMN IF NOT EXISTS shares_count int DEFAULT 0`.

### [PRIORITÉ MOYENNE] Amélioration du Feed et Ajout de Descriptions
- **Flux de publication (`AccueilScreen.js`)** : avant de confirmer la publication dans le feed, afficher un `TextInput` pour que l'utilisateur saisisse une description/légende libre. Ce texte est passé dans le champ `description` (ou `caption`) lors de l'insert dans la table `ootds`. Si le champ n'existe pas encore en base, ajouter une migration SQL `ALTER TABLE ootds ADD COLUMN IF NOT EXISTS caption text`.
- **Affichage dans le feed (`FeedScreen.js`)** : chaque post n'affiche plus que :
  1. Le nom de l'utilisateur (username + avatar)
  2. La photo plein écran
  3. La description/légende saisie par l'utilisateur
- **Supprimer du feed** : les chips de scores (`score_couleurs`, `score_coupe`, `score_tendance`), le conseil IA (`conseil`), le score global (`score_global`) et toutes les icônes de notation (🎨 ✂️ 🔥 ⭐). Garder uniquement les actions latérales (like, commentaire, partage).
- **Fichiers concernés** : `screens/AccueilScreen.js` (ajout du TextInput avant publication), `screens/FeedScreen.js` (nettoyage du rendu), et une nouvelle migration SQL si la colonne `caption` est ajoutée.

### [PRIORITÉ HAUTE] Correction Bug : Affichage des photos de profil
- Identifier pourquoi `avatar_url` ne s'affiche pas dans l'app (écrans Profil, Feed, Chat).
- Vérifier que le bucket `avatars` dans Supabase Storage est bien configuré en **public** et que les policies `SELECT` autorisent la lecture sans authentification.
- Vérifier que l'URL retournée par `supabase.storage.from('avatars').getPublicUrl(fileName)` est bien une URL publique accessible (pas une URL signée expirée).
- S'assurer que le composant `Avatar.js` et les `<Image>` inline dans `FeedScreen`, `FlammesScreen` et `ProfilScreen` tombent correctement sur le placeholder (initiale colorée) quand `avatar_url` est `null` ou invalide.
- Ajouter un `onError` sur les `<Image source={{ uri: avatar_url }}>` pour basculer sur le placeholder en cas d'échec de chargement.
- **Fichiers concernés** : `components/Avatar.js`, `screens/ProfilScreen.js` (upload + affichage), `screens/FeedScreen.js` (avatar dans les posts), `screens/FlammesScreen.js` (avatars conversations et stories).

### [PRIORITÉ BASSE] Optimisation Responsive et Adaptabilité Multi-Écrans (iOS / Android)
- S'assurer que l'application s'adapte automatiquement à toutes les tailles de smartphones (écrans compacts comme les iPhone SE jusqu'aux grands écrans comme les versions Max / Ultra).
- **Règles de code :** Remplacer les dimensions fixes en pixels durs par des mises en page fluides utilisant Flexbox, des pourcentages, ou des calculs dynamiques via l'API `Dimensions` de React Native.
- Vérifier l'alignement des boutons, des zones de texte et des images pour qu'aucun élément ne soit masqué, tronqué ou hors de l'écran selon le modèle de téléphone.
- **Fichiers concernés** : tous les écrans (`AccueilScreen.js`, `FeedScreen.js`, `FlammesScreen.js`, `ProfilScreen.js`, `AuthScreen.js`) et les composants (`Button.js`, `Avatar.js`, `FeedCommentsModal.js`).

### [PRIORITÉ MOYENNE] Implémentation Caméra Vidéo pour les Stories (Page Chat)
- Configurer le bouton "Créer une Story" pour qu'il demande les permissions d'accès à la caméra et au microphone du téléphone.
- Lors du clic, ouvrir l'interface de la caméra en **mode enregistrement vidéo** (et non photo).
- Permettre à l'utilisateur de démarrer et stopper l'enregistrement de son "Outfit of the day", puis de prévisualiser la vidéo avant de la poster.
- Permettre d'ajouter un texte superposé sur la vidéo (overlay) ainsi qu'une description libre avant publication.
- **Fichiers concernés** : `screens/FlammesScreen.js` (bouton Story + logique caméra), migrations SQL si la colonne `video_url` est ajoutée à la table `stories`.

### [PRIORITÉ MOYENNE] Refonte du Système de Niveaux et Progression Élevée
- **Réduire les points accordés par analyse IA** : la formule actuelle est `points = score_global * 10` (ex: score 7 → 70 pts). La rendre plus challengeante — par exemple `points = Math.round(score.global * 3)` ou toute valeur plus faible à définir.
- **Calcul des paliers de niveaux en progression exponentielle** : remplacer la formule linéaire actuelle (`niveau = Math.floor(points / 100) + 1`) par une formule exponentielle où chaque niveau exige beaucoup plus de points que le précédent.
  - Exemple de formule : `pointsPourNiveau(n) = 100 * Math.pow(1.8, n - 1)` (niveau 1 = 100pts, niveau 2 = 180pts, niveau 3 = 324pts, niveau 4 = 583pts…)
  - Ou formule puissance : `pointsPourNiveau(n) = Math.floor(50 * Math.pow(n, 2.2))` à calibrer selon le ressenti souhaité.
- **Fichier concerné** : `screens/AccueilScreen.js`, fonction `publishToFeed` (lignes ~270-290), calcul de `pointsGagnes` et `newNiveau`.
- **Mettre à jour `ARCHITECTURE.md`** avec la nouvelle formule retenue.

- [ ] **`.env`** : remplacer les placeholders par tes vraies clés (`EXPO_PUBLIC_*`). Le fichier existe déjà en local mais n’est pas versionné ; il doit correspondre au schéma de `.env.example`.
- [x] **Supabase** : toutes les migrations exécutées (schéma initial, comments, messages/stories, caption ootds, stories vidéo). Tables, RLS et buckets `avatars`, `ootds`, `stories` en place.
- [ ] **Migration GC stories** : exécuter `20260529120000_stories_gc.sql` dans le SQL Editor Supabase pour activer le trigger de suppression Storage et le job pg_cron horaire.
- [ ] **EAS — variables pour les builds** : définir sur [expo.dev](https://expo.dev) pour l’environnement `production` (ou celui utilisé par le profil build) au minimum `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GROQ_API_KEY`, sinon les binaires n’auront pas les clés embarquées.
- [ ] **Test sur téléphone** : télécharger l’APK de la dernière build preview (lien Expo « Artifacts ») et valider flux complet (Groq à l’accueil uniquement après analyse, notifications sur build standalone, snaps, likes).
- [ ] **`git remote` + push** : aucune remote configurée dans ce clone ; après `git remote add origin …`, lancer `git push -u origin master` (ou la branche souhaitée).
- [ ] **Backlog produit (optionnel)** : publication stores, analytics/crash reporting, erreurs hors ligne UX, modération, politique confidentialité/CGU.

- [ ] **Lire les migrations SQL** : examiner les fichiers dans `supabase/migrations/` pour comprendre le schéma exact, les politiques RLS, et les buckets storage.
- [ ] **Extraire les composants UI** : déplacer les éléments récurrents (boutons, cartes, modaux, indicateurs de chargement) du dossier `screens/` vers `components/` pour favoriser la réutilisation.
- [ ] **Améliorer la gestion d’erreurs** : remplacer les appels à `alert()` par un système de notifications moins intrusif (toast ou bannière) pour une meilleure UX.
- [ ] **Introduire le typage** : envisager la migration progressive vers TypeScript ou l’ajout de PropTypes pour détecter les tôt les bugs.
- [ ] **Vérifier le modal de commentaires** : confirmer l’implémentation de `FeedCommentsModal` et son interaction avec la table `comments` (ou équivalent) pour assurer le bon fonctionnement des interactions dans le feed.

---

## En cours

- _(Rien pour l’instant.)_

---

## Terminé

- [x] **Progression exponentielle des niveaux** (tâche 6) : points par analyse réduits (`score × 3` au lieu de `× 10`). Paliers exponentiels : niveau 2 = +100 pts, niveau 3 = +180 pts, niveau 4 = +324 pts (×1.8 à chaque fois). `AccueilScreen.js` → `publishToFeed`.
- [x] **Correction bug avatars** (tâche 7) : `Avatar.js` avec état `hasError` + `onError` fallback sur initiale. `ProfilScreen.js` idem. `FlammesScreen.js` : dict `avatarErrors` pour tous les avatars inline.
- [x] **Feed — Description + nettoyage** (tâche 8) : champ `TextInput` caption dans `AccueilScreen` avant publication. `FeedScreen` épuré : scores/conseil/chips supprimés, caption affichée. Migration `20260522150000_add_caption_to_ootds.sql` à exécuter dans Supabase.
- [x] **Feed — Nouveaux boutons d'action** (tâche 9) : colonne droite réorganisée (avatar auteur + badge `+` → like → commentaire → ➤ chat → `•••`). Envoi demande d'ami via tap avatar. Modale de partage vers une conversation Chat. Fidèle à `StyleAppliAccueil.png`.
- [x] **Responsive multi-écrans** (tâche 10) : `useWindowDimensions` ajouté sur AccueilScreen (scoreRing, boutons flex:1), AuthScreen (logo scalé), FlammesScreen (msgImage dynamique), ProfilScreen (avatar scalé). FeedScreen était déjà responsive.
- [x] **Audit global + correctifs** (2026-05-25) : `lib/utils.js` créé (computeNiveau, computeLevelInfo, timeAgo — dédoublonnés dans AccueilScreen, ProfilScreen, FeedScreen, FeedCommentsModal). `FeedCommentsModal` entièrement thématisé (`useTheme`). `AccueilScreen` : CRITERIA_KEYS mort supprimé, `alert()` → `showToast`, `noCreditsCard` avec couleurs thème + bouton navigue vers Shop, `computeNiveau` importé depuis utils. `ProfilScreen` : `computeLevelInfo` importé depuis utils. `FeedScreen` : `timeAgo` importé depuis utils. `FlammesScreen` : `sendPhotoMessage` XHR → `fetch+blob`, streak basé sur jours calendaires. `ShopScreen` : `claimPointsPack` supprimé, section "Gagner des points" convertie en informatif. `App.js` : badge non-lu sur l'onglet Chat via Supabase Realtime.
- [x] **Compression images/vidéos** (2026-05-29) : `expo-image-manipulator` (~14.0.8) pour les photos outfit (max 1200 px, qualité 0.75, JPEG, base64 via ImageManipulator). `react-native-compressor` (^1.18.2) pour les vidéos stories (VideoCompressor.compress, auto mode, maxSize 1280). Indicateur ActivityIndicator pendant compression. Build EAS required.
- [x] **Caméra vidéo Stories** (tâche 11) : `postStory` ouvre la caméra en mode vidéo (60 s max). Modal de prévisualisation avec `overlay_text` et `caption`. Upload MP4 dans bucket `stories`. Migration `20260523160000_stories_video.sql` à exécuter. `ProfilScreen` : barre de niveau corrigée (formule exponentielle), `alert()` remplacés par `showToast`, `MediaTypeOptions` déprécié corrigé. : colonne droite réorganisée (avatar auteur + badge `+` → like → commentaire → ➤ chat → `•••`). Envoi demande d'ami via tap avatar. Modale de partage vers une conversation Chat. Fidèle à `StyleAppliAccueil.png`.
- [x] **Réorganisation navigation** : onglets réordonnés Accueil (FeedScreen 🏠) → Chat (FlammesScreen 💬) → Analyse (AccueilScreen ✨) → Profil (ProfilScreen 👤). Barre nav fond blanc, icônes émoji, tinte rose actif.
- [x] **Refonte globale du style** : thème clair (fond `#FFFFFF`, texte `#111111`, accent `#ED93B1`) appliqué à tous les écrans — `App.js`, `FeedScreen` (onglets OOTD/POUR TOI), `FlammesScreen`/Chat, `AccueilScreen`, `ProfilScreen`, `AuthScreen`, `Button.js`. Maquettes `StyleAppliAccueil.png` et `StyleAppliChat.png` reproduites.
- [x] **Système de Chat Éphémère** : `FlammesScreen` transformé en messagerie complète. Table `messages` avec `expires_at` (TTL 24h, filtrage côté client). Texte + photos. Migration SQL `20260522140000_messages_stories.sql`. Streak flammes maintenu sur envoi photo.
- [x] **Stories** : ligne horizontale de cercles d’avatars en haut de l’écran Chat. Cercle "+" pour poster sa story (photo). Bordure rose = story active, grise = aucune. Table `stories` + bucket `stories` dans la même migration SQL. TTL 24h.
- [x] **Changement du logo** : `assets/logo.png` remplacé par `IMG_167811.jpg.jpeg`. ⚠️ Les autres assets (`adaptive-icon.png`, `splash-icon.png`, `favicon.png`) n’ont pas été redimensionnés — à faire manuellement si le look de l’icône app change.
- [x] Chaîne **variables d’environnement** : `lib/env.js`, `.env.example`, `lib/supabase.js`, clé Groq **uniquement** au moment de l’analyse (`AccueilScreen`) pour que le reste de l’app démarre si Groq est absent localement (erreur uniquement au clic analyse).
- [x] **Notifications push** : plugin `expo-notifications`, `UIBackgroundModes` iOS, permission Android `POST_NOTIFICATIONS`, enregistrement token hors Expo Go dans `App.js`, sauvegarde `profiles.push_token`.
- [x] **EAS** : profils `eas.json`, `cli.appVersionSource: remote`, scripts npm `eas:build:preview` / `eas:build:prod`, **build Android preview réussie** (APK sur le tableau de bord Expo du projet).
- [x] **Schéma initial Supabase + RLS + storage** : fichier migration versionné décrivant les tables utilisées par l’app (`profiles`, `ootds`, `likes`, `friendships`, `flammes`, `snaps`) et politiques storage pour `avatars` / `ootds`.
- [x] **Flammes** : paires `user1_id < user2_id` alignées sur la contrainte SQL ; `upsert` avec `onConflict` pour amitiés et flammes sans réinitialiser une flamme existante (`ignoreDuplicates` sur création initiale).
- [x] **Commit Git** local : tout le lot poussé en un commit (`Environnement Expo, push, EAS…`).