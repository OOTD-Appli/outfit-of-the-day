# 📧 Emails Supabase (réinitialisation mot de passe, confirmation) — mémo

## ✅ ÉTAT ACTUEL (2026-06-05) : SMTP Resend configuré

Custom SMTP **Resend** posé sur le projet via la Management API :

| Réglage | Valeur |
|---------|--------|
| `smtp_host` | `smtp.resend.com` |
| `smtp_port` | `465` |
| `smtp_user` | `resend` |
| `smtp_admin_email` (expéditeur) | `onboarding@resend.dev` |
| `smtp_sender_name` | `OOTD` |
| `rate_limit_email_sent` | `30` / h |

### ⚠️ Limite restante : Resend en **mode test** (domaine non vérifié)

Tant qu'aucun **domaine** n'est vérifié dans Resend, l'expéditeur est forcément
`onboarding@resend.dev` et Resend **ne délivre qu'à l'adresse propriétaire du
compte Resend** (`medi.freymann.jeux@gmail.com`) + ses adresses de test
(`delivered@resend.dev`…). Tout autre destinataire → **HTTP 403, non délivré**.

➡️ **Pour tester maintenant** : lance un « mot de passe oublié » avec
`medi.freymann.jeux@gmail.com` (s'il est bien un compte de l'app) → l'email
arrive (vérifie les spams).

➡️ **Pour envoyer à TOUS les utilisateurs** (gmail, outlook…), une seule étape
reste : **vérifier un domaine dans Resend** :
1. Resend → **Domains → Add Domain** (ex: `ootd-fr.app` ou tout domaine à toi).
2. Ajoute les enregistrements DNS fournis (SPF/DKIM) chez ton registrar.
3. Une fois « Verified », redonne-moi la main : je change `smtp_admin_email`
   pour `no-reply@ton-domaine` via l'API et l'envoi marche pour tout le monde.
   (Sans domaine perso, impossible d'envoyer aux adresses arbitraires.)

---

## ⚠️ Pourquoi l'email ne partait pas AVANT (historique)

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
- **SMTP** : ✅ Resend (`smtp.resend.com:465`, expéditeur `onboarding@resend.dev`)
- **Rate limit emails** : 30/h ✅
- **Reste à faire** : vérifier un domaine Resend pour délivrer à tous les users
  (sinon seul `medi.freymann.jeux@gmail.com` reçoit — cf. section « mode test »).

## Debug côté client

`screens/AuthScreen.js` → `sendResetLink()` logge désormais :
- `[resetPassword] envoi à … · redirectTo: …`
- en cas d'échec : `[resetPassword] échec Supabase: <status> <code> <message>`
- détection explicite du **429** (rate limit) avec message utilisateur dédié.
