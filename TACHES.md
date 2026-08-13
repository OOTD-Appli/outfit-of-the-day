# Suivi des tâches — OOTD

> Dernière mise à jour : 2026-08-14 — Corrections page Chat : Entrée pour envoyer, bulles à 50% de largeur, bug caméra photo (web).

---

## Corrections page Chat — 2026-08-14

- [x] **Entrée = envoyer** : dans `onChangeMessageText`, un texte se terminant par `\n` (touche Entrée) déclenche `sendTextMessage()` au lieu d'insérer un retour à la ligne — le `TextInput` contrôlé (`value={messageText}`) revient à l'état précédent, donc le `\n` ne s'affiche jamais. Plus besoin de taper sur la flèche d'envoi. *(Compromis assumé : plus de moyen de forcer un retour à la ligne manuel dans le champ — non demandé, à ajouter séparément si besoin un jour, ex. Shift+Entrée sur web.)*
- [x] **Bulles à 50% de largeur** : `styles.msgRow`/`styles.swipeableBubbleWrap` passés de `maxWidth: '78%'` à `'50%'` — les messages courts wrappent désormais bien plus tôt (bulle plus étroite mais visuellement plus haute), conforme à la demande.
- [x] **Taille photo dans la bulle recalculée** : `msgImgSize` (taille de l'image dans une bulle photo) était calculée comme `ww * 0.55`, complètement déconnectée de la largeur réelle de la bulle (78% puis 50% de `ww - 32` de padding liste, moins 24 de padding bulle). Résultat : la photo débordait visuellement de la bulle. Nouvelle formule : `(ww - 32) * 0.5 - 24`, qui fait exactement correspondre l'image à l'espace intérieur disponible de la bulle.
- [x] **Carte "profil partagé" corrigée en même temps** : `profileCardMsg` avait un `minWidth: 180` qui aurait dépassé la nouvelle largeur de bulle (50%) sur la quasi-totalité des téléphones — `minWidth` retiré, le contenu (avatar + texte flexible) s'adapte naturellement.
- [x] **Bug caméra chat (web) corrigé** : le bouton "Envoyer une photo" (icône caméra) ouvrait uniquement la galerie sur web (`ImagePicker.launchImageLibraryAsync`, sans `capture`), jamais l'appareil photo — alors que sur natif il ouvre bien `InAppCamera`. Nouvelle fonction `pickChatPhotoWeb()` (même technique que `AccueilScreen.pickImageWeb`) : `<input type=file accept="image/*" capture="environment">`, qui déclenche directement l'appareil photo sur mobile web/PWA. Import `expo-image-picker` retiré de `FlammesScreen.js` (devenu inutilisé).
- [x] Vérifications : `npm test` (64/64) + `npx expo export --platform web`.
- [ ] Non traité (hors périmètre de la demande, risque mineur identifié mais non reporté par l'utilisateur) : `styles.audioMsgRow` a un `minWidth: 150` qui pourrait légèrement déborder de la nouvelle bulle à 50% sur les téléphones les plus étroits (ex. iPhone SE) pour les messages vocaux spécifiquement — à surveiller si signalé.

---

## Monétisation — gating tier, verrouillages, rappels — 2026-08-12

D'après le Cahier des charges Monétisation OOTD (Shop, verrouillages, rappels).

- [x] **`lib/tier.js`** (nouveau, partagé) : `resolveTier()`, `getSubActive()`/`getActivePlan()`, `PERSONA_TIER`, `isPersonaUnlocked()`, `tierLabel()`. Réutilisé dans ShopScreen (refactor, dédoublonne `subActive`/`activePlan`), ProfilScreen, AccueilScreen.
- [x] **Personas IA par tier** : `coach`→Gratuit, `bienveillant`→Plus, `pote_hype`/`fashion_week`/`streetwear`→Elite. Vérifié **côté serveur** dans `analyze-outfit` (copie TS de la logique tier, dupliquée car pas de module partagé Expo/Deno — synchroniser manuellement avec `lib/tier.js` en cas de changement), jamais sur la seule foi du client.
- [x] **Migration** `20260812120000_persona_tier_gating.sql` : réassigne à `'coach'` les profils actuellement sur une personnalité désormais hors de portée (ex-défaut `fashion_week` devenu Elite-only), et change le défaut colonne en `'coach'`. **Appliquée en prod + Edge Function redéployée.**
- [x] **ProfilScreen** : personas hors tier affichées grisées + 🔒 + tier requis, tap → Shop (pas de sélection). Historique galerie plafonné à 21 tenues pour le Gratuit (`showHistoryLock`), bannière CTA → Shop ; Plus/Elite = pagination infinie inchangée.
- [x] **AccueilScreen** : 2 nouveaux rappels contextuels (cartes, pas des toasts — le composant toast de l'app n'a pas de CTA cliquable) : "Dernière analyse du jour" (Gratuit, `credits===1`, 1×/jour) et "Note ≥ 8/10" (Gratuit+Plus, jamais Elite, 1×/3 jours). Throttle via `AsyncStorage`, pas en DB.
- [x] **ShopScreen** : achat cosmétique avec points insuffisants → bouton visuellement grisé mais tap actif, toast "Il te manque N pts". Perks Plus/Elite mis à jour pour mentionner les personas IA débloquées.
- [x] **Anomalie "Historique complet" résolue** (option a du cahier des charges) : gating réellement implémenté plutôt que retiré de la liste des perks.
- [x] Vérifications : `npm test` (64/64) + `npx expo export --platform web` après implémentation complète.
- [ ] **À faire manuellement** : tester chaque ligne de la matrice sur un compte de chaque tier (gratuit/Plus/Elite) — non fait, nécessite des comptes de test réels.
- [ ] Ce qui n'a volontairement PAS été construit (déjà tranché) : achat direct d'un badge en argent réel, produit "reset de flamme" séparé (redondant avec le Gel de Flamme).

---

## Nouveau prompt d'analyse IA + personnalités du critique — 2026-08-11

- [x] **Nouveau prompt `analyze-outfit`** (fourni par l'utilisateur) : ajoute un garde-fou anti-hallucination de marques, une règle de gestion du cadrage/visibilité (pas de malus si un élément est hors champ), une règle de spécificité obligatoire (chaque analyse doit citer un détail visible précis), et des barèmes de notation en fourchettes (ex. `-1 à -3 pts`) plutôt qu'en valeurs fixes pour un jugement plus nuancé. Schéma JSON de sortie et les 20 hashtags de style **inchangés** — aucun impact sur le parsing existant.
- [x] **Correction apportée au prompt fourni** : la phrase d'intro couplait "attitude" ET "niveau d'exigence" à la personnalité choisie. Reformulée pour que la personnalité influence **uniquement le ton** des textes générés — le barème de notation reste strictement identique quelle que soit la personnalité, afin que les notes et les points gagnés (`award_points_for_ootd`) restent comparables entre utilisateurs (sinon un utilisateur pourrait choisir la personnalité la plus indulgente pour gonfler ses points).
- [x] **5 personnalités** (clés fermées, texte de ton vivant uniquement côté serveur — jamais de texte libre envoyé par le client) : `fashion_week` (Critique fashion week, exigeante — défaut), `bienveillant` (Styliste bienveillant), `pote_hype` (Meilleure pote hype), `coach` (Coach mode motivant), `streetwear` (Icône streetwear).
- [x] **Migration** `20260811120000_analysis_personality.sql` : colonne `profiles.analysis_personality` (text, défaut `'fashion_week'`) + CHECK sur les 5 clés. **⚠️ À exécuter dans le SQL Editor Supabase.**
- [x] **`supabase/functions/analyze-outfit/index.ts`** : accepte `personality` (clé fermée) dans le body, valide contre la liste serveur, fallback `fashion_week` si absent/invalide, injecte le texte de ton dans le prompt via `buildPrompt()`.
- [x] **`AccueilScreen.js`** : lit `profiles.analysis_personality` (déjà chargé dans `fetchCredits`) et l'envoie à chaque appel `analyze-outfit`.
- [x] **`ProfilScreen.js`** : nouvelle section "Personnalité du critique IA" dans Paramètres (5 lignes sélectionnables, emoji + nom + description courte, check visuel sur l'option active). Update direct (`supabase.from('profiles').update(...)`), même pattern que `specialized_feed`/`is_private`.
- [x] Vérifications : `npm test` (64/64) + `npx expo export --platform web` (build complet sans erreur) après implémentation.
- [x] **Migration appliquée en prod** (`supabase db push`) et **Edge Function redéployée** (`supabase functions deploy analyze-outfit`) — la fonctionnalité est live côté backend.
- [ ] **Reste à faire** : committer/pousser ces changements de code (GitHub) et redéployer le build web (Vercel) pour que la PWA reflète le nouveau sélecteur de personnalité — pas fait automatiquement, à confirmer avec l'utilisateur.

---

## Passe d'optimisation performance / stabilité — 2026-08-11

> Objectif : app plus rapide et plus stable, **zéro fonctionnalité retirée**. Audit préalable (lecture seule) sur les FlatList, images, animations, fuites mémoire, fetch réseau et config build, puis correctifs appliqués et vérifiés (`npm test` + `npx expo export --platform web` en boucle après chaque lot).

### Chat (`FlammesScreen.js`) — le point le plus impactant
- [x] **Liste de messages : `ScrollView` → `FlatList`** (non inversée, ordre et scroll identiques à l'existant — `onContentSizeChange` + `scrollToEnd` conservés à l'identique). Avant : les ~60 messages max de la conversation étaient TOUS montés en permanence (animations, `PanResponder` de swipe-to-reply, waveform audio) même hors écran. Après : virtualisation réelle (`windowSize`, `initialNumToRender`, `maxToRenderPerBatch`) — seuls les messages visibles + une marge sont montés.
  - *Choix technique* : une variante `inverted` (plus proche du pattern « chat » habituel) a été envisagée mais écartée pour cette passe — elle exige un contre-transform visuel par item (`scaleY:-1`) que je ne peux pas vérifier visuellement dans cet environnement sans simulateur/device. La version non-inversée obtient l'essentiel du gain (virtualisation) sans ce risque visuel. **À évaluer plus tard avec test manuel sur device si on veut aller plus loin.**
- [x] **`MessageBubble` extrait en composant mémoïsé** (`React.memo`) : chaque bulle (swipe, waveform audio, badges like/lu) ne se re-rend plus quand un state sans rapport change ailleurs dans l'écran (saisie du champ texte, indicateur "en train d'écrire", ouverture d'une modale...).
- [x] **Lookup du message parent (reply-quote)** : `messages.find()` par bulle (O(n) × n bulles = O(n²)) remplacé par une `Map` indexée une fois par changement de `messages` (O(1) par bulle).
- [x] **Liste des conversations (amis)** : `renderItem` extrait en composant `ConversationRow` mémoïsé + stabilisé (`useCallback`).
- [x] **Lookups flamme/story par ami** (`flammes.find()`, `stories.some()`/`.find()`) : remplacés par des `Map`/`Set` indexés une fois (`flammeByFriendId`, `storiesByUserId`) au lieu d'un parcours linéaire répété à chaque ligne de la liste.
- [x] **`fetchData` (chargement de l'écran Chat)** : 6 requêtes Supabase indépendantes qui s'enchaînaient en cascade (profils amis, demandes entrantes/sortantes, flammes, stories, derniers messages) sont désormais lancées en parallèle (`Promise.all`) — c'était le fetch le plus lourd de l'app.
- [x] **Fuite mémoire** : enregistrement vocal en cours (timer `setInterval`) et son en lecture (`expo-av`) non nettoyés si l'utilisateur quitte l'écran pendant un enregistrement/une lecture — cleanup ajouté au démontage.

### Profil (`ProfilScreen.js`)
- [x] `fetchProfil` : 3 requêtes indépendantes (profil, tenues, abonnement) passées en `Promise.all` au lieu de s'enchaîner.
- [x] Galerie 3 colonnes : `renderItem` extrait en composant `GridItem` mémoïsé + `getItemLayout` ajouté (cellules carrées, hauteur déductible de la largeur d'écran) → scroll plus fluide, moins de recalculs de layout.
- [x] Lightbox plein écran : fenêtrage (`windowSize`/`maxToRenderPerBatch`) ajouté — plus de risque de monter toute la galerie en mémoire d'un coup à l'ouverture.
- [x] Images (avatar, grille, lightbox) migrées de `Image` (react-native) vers `expo-image` (cache disque, decode hors thread JS).

### Analyse (`AccueilScreen.js`)
- [x] Fuite mémoire : debounce de recherche musique Deezer (`setTimeout`) non annulé si l'utilisateur quitte l'écran pendant les 420ms de debounce — cleanup ajouté.
- [x] **Code mort supprimé** : une animation (`barsProgress`, `Animated.timing` à chaque affichage de résultat) était calculée et jouée mais n'était plus consommée par aucun style/composant — travail CPU inutile à chaque analyse, retiré.
- [x] Images (aperçu photo, résultat, miniatures "top OOTD") migrées vers `expo-image`.

### Personnalisation (`CustomizationScreen.js`) & `components/Avatar.js`
- [x] Images (aperçu, pochettes musique Deezer, avatar) migrées vers `expo-image`.

### Build / bundle
- [x] **`babel-plugin-transform-remove-console`** ajouté (uniquement en production, `console.error`/`console.warn` conservés pour le diagnostic) — retire le bruit `console.log` du bundle release (dont un log qui affichait un email en clair lors de la réinitialisation de mot de passe).
- [x] **`metro.config.js`** : `inlineRequires` activé — les modules ne sont chargés qu'à leur premier usage réel plutôt que tous au démarrage (démarrage JS plus rapide, surtout sur mobile).
- [x] **Filet de sécurité** : `__tests__/screens.smoke.test.js` ajouté — vérifie que les 8 écrans se chargent sans erreur de syntaxe/import (détecte une régression avant un build EAS).
- [ ] `expo-system-ui` semble être une dépendance déclarée mais non importée nulle part dans le code — **non retirée par prudence** (dépendance native, impact build iOS/Android non vérifiable sans device). À confirmer puis retirer dans une session avec accès à un simulateur.
- [x] Logos statiques (`AuthScreen`, `ResetPasswordScreen`, `AppHeader`, `ShopScreen`) : migrés vers `expo-image` par cohérence (assets locaux `require(...)`, gain marginal mais aucun risque).

### Vérifications effectuées
- `npm test` (64/64) après chaque lot de changements.
- `npx expo export --platform web` (build de production complet, 928 modules) exécuté avec succès après les changements les plus structurels (confirme que Babel/Metro compilent tout sans erreur avec la nouvelle config `transform-remove-console`/`inlineRequires`).
- **Non vérifié visuellement** (pas de simulateur/device dans cet environnement) : rendu réel du chat après migration `FlatList`, comportement du scroll/clavier. À valider manuellement (`npm run ios`/`npm run android`/`npm start`) avant prochain build EAS — recommandé de tester en priorité : ouverture d'une conversation, envoi de message texte/photo/vocal, swipe-to-reply, scroll dans un historique de 20+ messages.

---

## Galerie détaillée, téléchargement & affichage des notes — 2026-06-24

### Persistance & galerie profil détaillée — `screens/ProfilScreen.js`
- [x] **Réutilisation des colonnes existantes** plutôt que d'ajouter `ratings`/`description`/`ai_advice` : les 4 notes sont déjà stockées dans `ootds` (`score_global`, `score_couleurs`=harmonie, `score_coupe`=fit, `score_tendance`=détails), avec `conseil` et `caption`. Aucune migration de données nécessaire.
- [x] Les requêtes de la galerie (`fetchProfil` + `loadMoreOotds`) chargent désormais toutes les métadonnées.
- [x] **Lightbox enrichie** : badge note globale + date, 3 badges colorés (Fit / Harmonie / Détails), chips de style, section Description (`caption`), section Conseils IA (rendu structuré points forts / à améliorer, ou texte brut). Helpers `NOTE_BADGES`, `fmtNote`, `parseConseil`.

### Téléchargement des photos sur l'appareil
- [x] Nouveau helper `lib/downloadImage.js` : natif via `expo-media-library` + `expo-file-system/legacy` (permission → `downloadAsync` → `saveToLibraryAsync` → nettoyage temp), **fallback web** (lien `<a download>`).
- [x] Bouton de téléchargement (avec spinner) dans la barre de la lightbox `ProfilScreen`.
- [x] Dépendances installées (`expo-media-library` ~18.2.1, `expo-file-system` ~19.0.23) + plugin `expo-media-library` et message de permission dans `app.json`.
- [ ] **Rebuild EAS requis** pour activer le téléchargement sur l'app native (`npm run eas:build:preview`). Fonctionne déjà côté web sans rebuild.

### Switch œil d'affichage des 4 notes (toggle local par écran)
- [x] **Feed** (`screens/FeedScreen.js`) : scores ajoutés aux `select` (fetch + loadMore), bouton 👁 (`eye`/`eye-off`) dans la barre du haut, carte de notes en overlay sur la photo (`FEED_NOTES`, `fmtFeedNote`). État local non persisté.
- [x] **Flammes** (`screens/FlammesScreen.js`) : bouton 👁 dans l'en-tête du chat, badges des 4 notes sous les messages image porteurs de scores (`SNAP_NOTES`, `fmtSnapNote`).
- [x] **Propagation des scores à l'envoi** (`AccueilScreen.sendOutfitToSelectedFlammes`) : `scoreFields` injecté dans les inserts `snaps` ET `messages`. `loadMessages` charge les colonnes scores ; les nouveaux messages Realtime les portent via `payload.new`.
- [x] **Migration** `20260621120000_snaps_messages_scores.sql` : colonnes `score_global/couleurs/coupe/tendance` + `conseil` (nullables) sur `snaps` et `messages`. **✅ Appliquée dans le SQL Editor + vérifiée** (REST 200 sur les nouvelles colonnes).

### Vérifications
- [x] Compilation Babel OK sur les 5 fichiers modifiés.
- [x] Suite de tests verte (56/56, 2 suites).

---

## Refonte boutique & abonnements — 2026-05-31

### Premium (Stripe) — configuré en mode TEST
- [x] Intégration Stripe complète (Edge Functions, webhook, Customer Portal, secrets) — cf. `STRIPE_SETUP.md`.
- [x] Nouvelle grille : **OOTD Plus 2,99€/mois**, **OOTD Elite 4,99€/mois** (prix Stripe recréés, secrets `STRIPE_PRICE_*` mis à jour, affichage `ShopScreen` aligné).
- [ ] Passage en **live** (clés `sk_live_…`) : à refaire produits/webhook/portal + secrets quand prêt.

### Achats Express (Stripe one-time 0,99€) — migration `20260531140000_shop_express.sql`
- [x] **Gel de Flamme** `0,99€` et **Pack 2 000 Points** `0,99€` : paiement Stripe unique (mode `payment`).
- [x] Edge Function `create-payment-session` (mode payment) + traitement webhook `checkout.session.completed`.
- [x] RPC `apply_one_time_purchase` (service_role) + table `processed_payments` (idempotence par session). Crédit posé UNIQUEMENT par le webhook.
- [x] Secrets `STRIPE_PRICE_FLAME_FREEZE` / `STRIPE_PRICE_POINTS_2000` ; event `checkout.session.completed` ajouté au webhook.

### Boutique Points — grille FINALE (migration `…140000` ; `…130000` superseded)
- [x] **Prix cosmétiques par rareté** (appliqués côté serveur dans `buy_cosmetic`) :
  - Thèmes : Midnight/Émeraude `1000 pts`, Or Prestige/Sakura `1500 pts`.
  - Logos : Flamme `150 pts`, Diamond/Étoile Pro/Couronne `200 pts`.
- [x] **Gel de Flamme** : acquisition désormais en euros (cf. Achats Express). Colonne `profiles.flame_freezes` + consommation auto via `use_flame_freeze` dans `FlammesScreen` quand un oubli briserait le streak. `flame_freezes` protégé par `profiles_guard_sensitive`.
- [~] `buy_pass_24h` / `buy_flame_freeze` (points) : RPC créées en `…130000` puis **retirées de l'UI** (Pass 24h supprimé, Gel de Flamme passé en euros). RPC laissées en base, inutilisées.
- [x] Logique boutons `ShopScreen` : Elite = tout gratuit (Équiper/Équipé), sinon prix points → pop-up confirmation → achat → Équiper → Équipé.
- [x] `ShopScreen` rangé en **3 sections** : Premium · Achats Express · Boutique Points.

### Flammes : expiration grisée + restauration + distribution mensuelle — migration `20260531150000_flamme_restore.sql`
- [x] **Expiration dérivée** de `flammes.last_snap_at` : ≤24h active · 24–72h éteinte (grisée, restaurable) · >72h perdue (0). Affichage grisé + tappable dans la liste de conversations ET le header de chat (`FlammesScreen`).
- [x] **Restauration manuelle** : clic sur la flamme grisée → modal « Utilisez mon gel de flammes ». RPC `restore_flamme(flamme_id)` (fenêtre 48h, consomme 1 gel, ranime `last_snap_at`). Si 0 gel → bouton vers le Shop (0,99€). Auto-consommation précédente (`use_flame_freeze` au snap) **retirée**.
- [x] **Distribution mensuelle** : `claim_monthly_freezes` (Free 1 / Elite 2), claim paresseux appelé au focus de Shop et Flammes (colonne `last_freeze_grant`, idempotent/mois). *(Pas de cron : grant à l'ouverture de l'app.)*
- [x] `profiles_guard_sensitive` étend la protection à `last_freeze_grant`. Compteur ❄️ affiché en haut du Shop.

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
- [x] **SEC-09 — Validation `image_url` (ootds/messages)** : contraintes `CHECK ... NOT VALID` ajoutées dans `20260611150000_image_url_constraints.sql`. Pattern `^https://[a-z0-9-]+\.supabase\.co/storage/`. `NOT VALID` = nouvelles lignes validées, existantes non bloquées (lancer `VALIDATE CONSTRAINT` manuellement après nettoyage éventuel des anciennes URLs).
- [ ] **SEC-10 — Limites taille/type sur buckets Storage** : configurer `file_size_limit` et `allowed_mime_types` sur les buckets `avatars` (5 Mo, image/*), `ootds` (10 Mo, image/*), `stories` (100 Mo, video/mp4). **À faire dans Supabase Dashboard > Storage > Edit bucket**.

### 🟡 MOYENS

- [x] **SEC-11 — Validation `base64Image` dans l'Edge Function** : vérification longueur max 10 Mo + MIME prefix valide (jpeg/png/webp). `supabase/functions/analyze-outfit/index.ts`.
- [x] **SEC-12 — `alert()` dans `notifications.js`** : remplacé par `console.warn` (évite crash sur certains contextes RN).
- [x] **SEC-13 — Logs sensibles supprimés** : `console.log('[publishStory] url publique:')` retiré de `FlammesScreen.js`.
- [x] **SEC-14 — Fuite `push_token` via `profiles SELECT`** : migration `20260611140000_profiles_private.sql` — table `profiles_private(id, push_token)` avec RLS owner-only, migration des tokens existants, suppression de `profiles.push_token`. `lib/notifications.js` ciblait déjà `profiles_private`.
- [x] **SEC-15 — CORS `*` sur l'Edge Function** : toutes les Edge Functions lisent désormais `Deno.env.get('APP_ORIGIN') ?? '*'`. Ajouter le secret `APP_ORIGIN` dans Supabase Dashboard pour restreindre à l'origine de la PWA.
- [x] **SEC-16 — Rate-limit applicatif Edge Function** : migration `20260611160000_analyze_rate_limit.sql` — table `analyze_rate_limit` + RPC `check_analyze_rate_limit` (SECURITY DEFINER, fenêtre 1 min). `analyze-outfit` appelle la RPC avant `consume_daily_credit` ; 5 req/min max par user → 429 si dépassé.

---

## Social & UX — 2026-06-12

### Read receipts (messagerie) — migration `20260602120000` + `FlammesScreen.js`
- [x] **3 états visuels** : 1 chevron gris (optimiste = envoi en cours) · 2 chevrons gris (livré, `read_at = null`) · 2 chevrons couleur accent (lu, `read_at ≠ null`). Composant `ReadStatus` inline.
- [x] `mark_messages_read` RPC appelé à l'ouverture du chat ET à la réception Realtime — inchangé, déjà fonctionnel.

### Swipe-to-reply — migration `20260612100000_messages_reply_to.sql` + `FlammesScreen.js`
- [x] Migration SQL : colonne `reply_to_id uuid FK messages(id) ON DELETE SET NULL` + index.
- [x] `SwipeableMessageBubble` : `PanResponder` sur les bulles reçues (swipe droite ≥48px → déclenche la réponse + haptic).
- [x] Barre de reply au-dessus du `TextInput` : affiche sender + aperçu message · bouton ✕ · disparaît après envoi.
- [x] `sendTextMessage` passe `reply_to_id` à l'INSERT si `replyingTo` est défini.
- [x] Quote du message parent affichée dans la bulle (si `reply_to_id` trouvé dans la liste).
- [ ] **À faire manuellement** : exécuter la migration `20260612100000_messages_reply_to.sql` dans Supabase SQL Editor.

### Nouveau flux post-analyse — `AccueilScreen.js`
- [x] Suppression de l'auto-ouverture de `CustomizationScreen` après `analyzeOutfit()`.
- [x] Remplacement de l'`actionsCard` (avec doublons music/caption) par 2 boutons : **Personnaliser et partager** (ouvre `CustomizationScreen`) + **Analyser une nouvelle tenue** (reset).
- [x] `CustomizationScreen` reste la seule surface de modification (caption, musique, publish, flammes, save).

### Section stories dans l'onglet Analyse — `AccueilScreen.js`
- [x] Section "Ma story" en bas du scroll (toujours visible, après les résultats d'analyse).
- [x] Si story active : aperçu thumbnail + badge "En ligne" + tap → viewer vidéo/image.
- [x] Si pas de story : bouton "Publier une story" (photo ou vidéo, galerie ou caméra, TTL 24h).
- [x] Modal de publication : preview média + champs overlay_text + caption + boutons Annuler/Publier.
- [x] `fetchMyStory()` au focus de l'onglet (idempotent, RLS respected).
- [ ] Optionnel : afficher aussi les stories des amis dans cette section (actuellement dans Chat uniquement).

### Tab bar glassmorphism — `App.js`
- [x] Fond semi-transparent (`+E8` sur hex) + `backdropFilter: blur(20px)` sur web.
- [x] Ombre portée renforcée (shadowRadius 20, elevation 16).

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

## Chat : Likes et Suppression de Messages — 2026-06-02

- [x] **Migration** `20260602120000_messages_interactions.sql` : colonnes `is_liked` + `is_deleted` sur `messages`, `REPLICA IDENTITY FULL`, publication Realtime, RPC `toggle_message_like` (destinataire uniquement, SECURITY DEFINER), RPC `delete_message` (soft delete + retourne `image_url` pour nettoyage Storage, SECURITY DEFINER). **⚠️ À exécuter dans le SQL Editor Supabase.**
- [x] **Likes** : double-tap ou appui long sur un message reçu → toggle ❤️. Badge cœur affiché en coin de bulle. Optimistic update + rollback. Synchro temps réel via Supabase Realtime (event UPDATE).
- [x] **Suppression** : appui long sur un message envoyé → Alert/window.confirm → RPC `delete_message` → soft delete (bulle remplacée par "Ce message a été supprimé" pour les deux participants). Nettoyage Storage du fichier image si présent. Temps réel via Realtime.
- [x] **Realtime** : abonnement `channel chat-{userId}-{friendId}` gérant INSERT (nouveaux messages), UPDATE (like/suppression), DELETE. Nettoyage du channel au démontage du composant.

---

## Abonnements Premium Stripe (2026-05-31)

> Économie séparée : **points** (cosmétiques, inchangé) vs **abonnement Stripe** (Premium). Voir `STRIPE_SETUP.md` pour la configuration complète (secrets, price IDs, webhook, déploiement).

- [x] **Migration** `20260531120000_subscriptions_stripe.sql` : table `subscriptions` (RLS lecture seule), helper `is_elite()`, RPC webhook-only `apply_subscription_change()` (EXECUTE réservé `service_role`), `consume_daily_credit()` v2 (Elite illimité / Plus 20 / Free 2), `equip_cosmetic()` v2 (Elite débloque tous les cosmétiques). ⚠️ À exécuter dans Supabase.
- [x] **Edge Functions** (Deno + SDK Stripe officiel) : `create-checkout-session` (Checkout abonnement), `stripe-webhook` (events subscription → RPC, déployer `--no-verify-jwt`), `create-portal-session` (Customer Portal). Commentaires de config des secrets en tête de chaque fichier.
- [x] **ShopScreen** refondu (thème clair/rose via `useTheme`) : section **Premium** (Plus 4,99€ / Elite 9,99€, boutons S'abonner → `Linking` vers Stripe, statut + date de renouvellement + Gérer via portail) ; section **Points** (pass + cosmétiques, RPC inchangées, accès Elite affiché).
- [x] **AccueilScreen** : `fetchCredits` lit l'abonnement → Elite = illimité (pas de blocage), Plus/pass = 20, sinon 2. Pastille « Analyses illimitées » + gestion sentinelle `-1` renvoyée par `consume_daily_credit`.
- [x] **ProfilScreen** : badge `💎 Elite` / `⭐ Plus` sous le pseudo (abonnement actif).
- [x] **app.json** : `"scheme": "ootd"` pour le retour deep-link Stripe.

---

## Mise au pixel des maquettes (2026-05-31)

- [x] **Écran Analyse refondu** (`AccueilScreen.js`) pour coller aux maquettes `AnalysePage.png` / `AnalysePageResult.png`. Logique inchangée (analyse Groq, crédits, publication feed, envoi flammes, top OOTDs).
  - État AVANT : en-tête centré + cloche déco, carte upload à **bordure pointillée**, cercle caméra en dégradé (`expo-linear-gradient` + icône `Ionicons`), sous-titres « Place-toi bien… » / « Sélectionne une photo existante », carte conseil « Conseil 🤍 », section « Comment ça marche ? » à 3 cartes avec icônes rondes.
  - État APRÈS : 3 jauges en **arc partiel coloré** (Fit rose, Harmonie mauve, Détails camel) via nouveau composant `components/Gauge.js` (react-native-svg), note globale + badge étoile, conseil avec personnage, « Tes OOTD les plus performants » + compteurs ❤️ (ajout `likes(count)` au fetch), boutons Publier/Flammes conservés.
- [x] **Nouvelle dépendance** : `react-native-svg` (via `npx expo install`) pour les jauges. ⚠️ Rebuild EAS requis ; fonctionne déjà dans Expo Go.
- [x] **Feed** (`FeedScreen.js`) : onglet actif (OOTD/POUR TOI) en **rose accent** au lieu de blanc (cf. `StyleAppliAccueil.png`).
- [x] **Chat** (`FlammesScreen.js`) : titre « Chat » **centré** (loupe en absolu à droite), cf. `StyleAppliChat.png`.

### Correctifs UI (2026-05-31)

- [x] **Photo persistante après analyse** (`AccueilScreen.js`) : l'image analysée (`image.uri`, state local) reste affichée en haut de l'état résultat, sous le titre et au-dessus des blocs de score (dans le `ScrollView` existant, style `resultPhoto`). Aucune modif de la logique IA.
- [x] **Suppression barre vierge au-dessus de la tab bar** : double inset bas corrigé. Tous les écrans à onglets passent en `SafeAreaView edges={['top']}` (AccueilScreen, FlammesScreen liste + chat, ProfilScreen, ShopScreen ×2) — la tab bar gère déjà l'inset bas. AuthScreen (hors tab bar) inchangé.

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