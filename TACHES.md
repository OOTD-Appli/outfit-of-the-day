# Suivi des tâches — OOTD

> Dernière mise à jour : lots automatisés (schéma SQL, config push, build EAS, commit local).

---

## À faire (reste de ton côté)

- [ ] **`.env`** : remplacer les placeholders par tes vraies clés (`EXPO_PUBLIC_*`). Le fichier existe déjà en local mais n’est pas versionné ; il doit correspondre au schéma de `.env.example`.
- [ ] **Supabase** : exécuter la migration `supabase/migrations/20260510120000_initial_schema.sql` sur ton projet (SQL Editor ou CLI), ou aligner ta base existante avec ce schéma (tables, RLS, buckets `avatars` + `ootds`).
- [ ] **EAS — variables pour les builds** : définir sur [expo.dev](https://expo.dev) pour l’environnement `production` (ou celui utilisé par le profil build) au minimum `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GROQ_API_KEY`, sinon les binaires n’auront pas les clés embarquées.
- [ ] **Test sur téléphone** : télécharger l’APK de la dernière build preview (lien Expo « Artifacts ») et valider flux complet (Groq à l’accueil uniquement après analyse, notifications sur build standalone, snaps, likes).
- [ ] **`git remote` + push** : aucune remote configurée dans ce clone ; après `git remote add origin …`, lancer `git push -u origin master` (ou la branche souhaitée).
- [ ] **Backlog produit (optionnel)** : publication stores, analytics/crash reporting, erreurs hors ligne UX, modération, politique confidentialité/CGU.

---

## En cours

- _(Rien pour l’instant — le lot précédent est intégré au dépôt.)_

---

## Terminé

- [x] Chaîne **variables d’environnement** : `lib/env.js`, `.env.example`, `lib/supabase.js`, clé Groq **uniquement** au moment de l’analyse (`AccueilScreen`) pour que le reste de l’app démarre si Groq est absent localement (erreur uniquement au clic analyse).
- [x] **Notifications push** : plugin `expo-notifications`, `UIBackgroundModes` iOS, permission Android `POST_NOTIFICATIONS`, enregistrement token hors Expo Go dans `App.js`, sauvegarde `profiles.push_token`.
- [x] **EAS** : profils `eas.json`, `cli.appVersionSource: remote`, scripts npm `eas:build:preview` / `eas:build:prod`, **build Android preview réussie** (APK sur le tableau de bord Expo du projet).
- [x] **Schéma initial Supabase + RLS + storage** : fichier migration versionné décrivant les tables utilisées par l’app (`profiles`, `ootds`, `likes`, `friendships`, `flammes`, `snaps`) et politiques storage pour `avatars` / `ootds`.
- [x] **Flammes** : paires `user1_id < user2_id` alignées sur la contrainte SQL ; `upsert` avec `onConflict` pour amitiés et flammes sans réinitialiser une flamme existante (`ignoreDuplicates` sur création initiale).
- [x] **Commit Git** local : tout le lot poussé en un commit (`Environnement Expo, push, EAS…`).

---

*Les cases « À faire » ne peuvent être cochées que par une action sur tes comptes (Supabase, Expo, téléphone réel, remote Git).*
