# Suivi des tâches — OOTD

> Dernière mise à jour indicative : vue d’ensemble du dépôt et des fichiers modifiés en local.

---

## À faire

- [ ] Créer un fichier `.env` local (copie de `.env.example`) avec les **vraies** valeurs : `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GROQ_API_KEY`.
- [ ] Vérifier côté **Supabase** : tables utilisées dans l’app (`profiles` avec champ `push_token`, `ootds`, `likes`, `friendships`, `flammes`), **RLS** et buckets (`avatars`).
- [ ] Vérifier / compléter la config **Expo Notifications** pour les builds production (référence projet EAS, canaux Android, comportement hors dev client Expo).
- [ ] Lancer une build **EAS** (profil `preview` ou `production`) et tester l’installation sur appareil réel (push, scoring Groq, feed, profil).
- [ ] Définir : **commits** puis éventuelle **push** pour sauvegarder le travail en cours (`App.js`, écrans, `lib/*`, `eas.json`, `package.json`, etc.).
- [ ] Prévoir la suite produit selon tes objectifs : publication store, analytics, erreurs hors ligne, modération du contenu, etc.

---

## En cours

- [ ] Chaîne **variables d’environnement** centralisées (`lib/env.js`, `.env.example`, utilisation depuis `supabase.js` et `AccueilScreen.js`).
- [ ] Intégration **notifications push** : enregistrement du token, sauvegarde dans `profiles` (`lib/notifications.js`, branches dans `App.js`).
- [ ] Configuration **EAS Build** (`eas.json`, métadonnées `app.json` / identifiant projet).
- [ ] Écrans reliés au backend pour le flux social : **`AccueilScreen`**, **`FeedScreen`**, **`FlammesScreen`**, **`ProfilScreen`**.

*(Ces pistes reflètent les fichiers actuellement modifiés dans le dépôt local mais pas encore livrés en commit distant.)*

---

## Terminé

- [x] Application **Expo** avec navigation par **onglets** (Accueil, Feed, Flammes, Profil) et écran **Auth** (connexion / inscription + création de ligne `profiles`).
- [x] Client **Supabase** avec session persistée (`AsyncStorage`) dans `lib/supabase.js`.
- [x] **Accueil** : choix / prise de photo, score OOTD via API **Groq** (critères fit / harmonie / détail).
- [x] **Feed** : liste des OOTD, affichage auteur, **likes** avec mise à jour optimiste.
- [x] **Flammes** : amis, recherche de profils, flux type flammes / snaps (selon implémentation actuelle).
- [x] **Profil** : avatar (upload storage `avatars`), grille des OOTD utilisateur, déconnexion.

---

*Note : la colonne « Terminé » décrit ce qui est déjà implémenté dans le code à ce stade ; « En cours » correspond au lot de changements en cours de finalisation / validation.*
