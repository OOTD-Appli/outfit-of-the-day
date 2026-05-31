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
   EXPO_PUBLIC_GROQ_API_KEY
   ```
   Sans elles, le site se compile mais ne se connecte ni à Supabase ni à Groq.
4. **Deploy**.

### Build local (test avant push)
```bash
npm run build:web        # = expo export --platform web → dossier dist/
```

> ⚠️ Sécurité : sur le web, toutes les variables `EXPO_PUBLIC_*` sont **visibles publiquement** dans le bundle. La clé Supabase anon est faite pour ça (protégée par RLS). En revanche `EXPO_PUBLIC_GROQ_API_KEY` serait exposée — pour le web, préférer router l'analyse via l'Edge Function `analyze-outfit` (déjà déployée) plutôt qu'un appel Groq direct depuis le navigateur.

## 2. Android APK (Expo EAS)

Le profil `preview` d'`eas.json` produit déjà un **APK** (`"buildType": "apk"`).

```bash
npm i -g eas-cli          # si pas déjà installé
eas login                 # connexion au compte Expo
npm run eas:build:preview # build APK Android (lien de téléchargement à la fin)
```

- **Production (AAB pour le Play Store)** : `npm run eas:build:prod` (profil `production`, `app-bundle`).
- Le `projectId` EAS est déjà dans `app.json` (`extra.eas.projectId`).
