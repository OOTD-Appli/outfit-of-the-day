# 📧 Emails Supabase (réinitialisation mot de passe, confirmation) — mémo

## ⚠️ Pourquoi l'email de réinitialisation n'arrive pas

Diagnostic effectué le 2026-06-05 via la Management API sur le projet
`jjqisirnrodilxfkcbiq` :

| Réglage | Valeur constatée | Conséquence |
|---------|------------------|-------------|
| `smtp_host` | **vide** | Utilise le **service email de TEST intégré** de Supabase |
| `rate_limit_email_sent` | **2** | **2 emails/heure** pour TOUT le projet |
| `smtp_admin_email` / `smtp_host`… | vides | Impossible de monter la limite sans SMTP custom |

### Les 3 causes réelles (par ordre d'importance)

1. **Service email de test Supabase = très bas débit + très mauvaise délivrabilité.**
   Il est limité à **~2-3 emails/heure** et, sur les projets récents, ne délivre
   de façon fiable qu'aux adresses des **membres de l'organisation**. Score de
   confiance très faible auprès de Gmail/Outlook → finit souvent en **spam** ou
   est tout simplement **bloqué**.
2. **Quota dépassé.** Si tu as testé plusieurs fois d'affilée, les 2/h sont
   consommés → les envois suivants sont **silencieusement bloqués** (HTTP 429).
3. **Dossier Spams / Indésirables.** Même quand l'email part, vérifie TOUJOURS
   le dossier spam (Gmail : onglet « Promotions » aussi).

> ❗️ Idée reçue : un `redirectTo` non autorisé ne **bloque PAS** l'envoi. Supabase
> remplace simplement le lien par la `Site URL` et envoie quand même. Notre
> `redirectTo` (`https://ootd-fr.vercel.app/reset-password`) est bien dans
> l'allowlist (`https://ootd-fr.vercel.app/**`), donc ce n'est pas le souci ici.

---

## ✅ La VRAIE solution : configurer un SMTP personnalisé

Le service de test n'est **pas fait pour la production**. Il faut un fournisseur
SMTP. Option gratuite recommandée : **Resend** (3 000 emails/mois gratuits, 5 min
de config).

### Étapes

1. Crée un compte sur https://resend.com → génère une **API key** (`re_...`).
2. (Recommandé) Vérifie ton domaine d'envoi, ou utilise le domaine de test Resend.
3. Dans **Supabase → Authentication → Emails → SMTP Settings → Enable Custom SMTP** :
   - **Host** : `smtp.resend.com`
   - **Port** : `465`
   - **Username** : `resend`
   - **Password** : ta clé API Resend (`re_...`)
   - **Sender email** : une adresse de ton domaine vérifié (ex: `no-reply@tondomaine.com`)
   - **Sender name** : `OOTD`
4. Une fois le SMTP custom activé, monte **Rate Limits → Emails** à `30/h` ou plus
   (impossible tant que le SMTP custom n'est pas configuré — l'API renvoie
   « Custom SMTP required to configure RATE_LIMIT_EMAIL_SENT »).

> 💡 Cette config peut être posée automatiquement via la Management API
> (`PATCH /v1/projects/{ref}/config/auth` avec `smtp_host`, `smtp_port`,
> `smtp_user`, `smtp_pass`, `smtp_admin_email`, `smtp_sender_name`).
> Donne les identifiants SMTP et on l'applique d'un coup.

---

## État actuel de la config Auth (2026-06-05)

- **Site URL** : `https://ootd-fr.vercel.app` ✅
- **Redirect allowlist** : `https://ootd-fr.vercel.app/**`, `http://localhost:8081/**`, `http://localhost:19006/**` ✅
- **SMTP** : ❌ test intégré (à remplacer par un SMTP custom pour la prod)
- **Rate limit emails** : 2/h (verrouillé tant que SMTP test)

## Debug côté client

`screens/AuthScreen.js` → `sendResetLink()` logge désormais :
- `[resetPassword] envoi à … · redirectTo: …`
- en cas d'échec : `[resetPassword] échec Supabase: <status> <code> <message>`
- détection explicite du **429** (rate limit) avec message utilisateur dédié.
