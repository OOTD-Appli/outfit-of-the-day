# Déploiement OOTD

## 1. Web / PWA sur Vercel

Le build web est piloté par `vercel.json` (lu automatiquement par Vercel) :
- **Build command** : `expo export --platform web`
- **Output directory** : `dist`
- **Rewrites** : toutes les routes → `/index.html` (SPA)

### Étapes
1. Sur [vercel.com](https://vercel.com), **Import Project** → sélectionne le repo Git.
2. Vercel détecte `vercel.json` : ne change pas le build command / output.
3. **⚠️ Variables d'environnement** (Project → Settings → Environment Variables) — indispensables, elles sont **inlinées dans le bundle au build** :
   ```
   EXPO_PUBLIC_SUPABASE_URL
   EXPO_PUBLIC_SUPABASE_ANON_KEY
   ```
   Sans elles, le site se compile mais ne se connecte pas à Supabase.
   > **Ne PAS ajouter `EXPO_PUBLIC_GROQ_API_KEY`** : l'analyse passe par l'Edge Function `analyze-outfit`, qui lit le secret Supabase `GROQ_API_KEY` côté serveur. La clé Groq ne doit jamais être dans le bundle (web ou mobile).
4. **Deploy**.

### Build local (test avant push)
```bash
npm run build:web        # = expo export --platform web → dossier dist/
```

> ⚠️ Sécurité : sur le web, les variables `EXPO_PUBLIC_*` sont **visibles publiquement** dans le bundle. C'est sans risque ici : seule la clé Supabase **anon** y figure (faite pour ça, protégée par RLS). La clé **Groq reste serveur** (secret Supabase `GROQ_API_KEY` utilisé par l'Edge Function `analyze-outfit`) — ne jamais l'exposer en `EXPO_PUBLIC_*`.

## 2. Android APK (Expo EAS)

Le profil `preview` d'`eas.json` produit déjà un **APK** (`"buildType": "apk"`).

```bash
npm i -g eas-cli          # si pas déjà installé
eas login                 # connexion au compte Expo
npm run eas:build:preview # build APK Android (lien de téléchargement à la fin)
```

- **Production (AAB pour le Play Store)** : `npm run eas:build:prod` (profil `production`, `app-bundle`).
- Le `projectId` EAS est déjà dans `app.json` (`extra.eas.projectId`).
