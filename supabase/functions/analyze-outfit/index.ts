import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ORIGIN = Deno.env.get('APP_ORIGIN') ?? '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Modèle Gemini. 2.5-flash dispose du quota sur la clé fournie (2.0-flash = 0).
const GEMINI_MODEL = 'gemini-2.5-flash';

// Personnalités du critique IA — choisies par l'utilisateur dans Profil > Paramètres
// (colonne profiles.analysis_personality, migration 20260811120000). Le texte de
// chaque personnalité ne vit QUE côté serveur : le client envoie une clé fermée,
// jamais du texte libre (pas de prompt injection possible via ce champ).
// Volontairement : la personnalité influence uniquement le TON des textes générés,
// jamais le barème de notation — les notes/points doivent rester comparables entre
// utilisateurs quelle que soit la personnalité choisie.
const PERSONALITIES: Record<string, string> = {
  fashion_week: "Une critique de mode haute couture, analytique et exigeante, directe et sans complaisance dans le ton.",
  bienveillant: "Un styliste bienveillant et encourageant, qui valorise toujours ce qui fonctionne avant de suggérer une amélioration, avec douceur.",
  pote_hype: "Ta meilleure pote hyper complice et enthousiaste, avec un ton fun, spontané et un vocabulaire jeune et chaleureux.",
  coach: "Un coach mode motivant et constructif, qui formule chaque remarque comme un prochain palier à atteindre plutôt qu'un jugement.",
  streetwear: "Une icône du streetwear, pointue sur la culture urbaine et les tendances actuelles, qui valorise l'audace et l'originalité.",
};
const DEFAULT_PERSONALITY = 'coach';

// Gating par tier (Cahier des charges Monétisation 2026-08-12) — DOIT rester
// synchronisé avec lib/tier.js (PERSONA_TIER) côté client. Appliqué ici côté
// serveur car le client ne doit jamais être la seule barrière : un client
// modifié pourrait sinon envoyer n'importe quelle clé de personnalité.
const PERSONA_TIER: Record<string, 'free' | 'plus' | 'elite'> = {
  coach: 'free',
  bienveillant: 'plus',
  pote_hype: 'elite',
  fashion_week: 'elite',
  streetwear: 'elite',
};
const TIER_RANK: Record<'free' | 'plus' | 'elite', number> = { free: 0, plus: 1, elite: 2 };

function resolveTier(sub: { status?: string; plan_type?: string } | null, hasPlus: boolean, hasAnalysis: boolean): 'free' | 'plus' | 'elite' {
  const subActive = !!(sub && ['active', 'trialing'].includes(sub.status ?? ''));
  const activePlan = subActive ? sub!.plan_type : null;
  if (activePlan === 'elite') return 'elite';
  if (activePlan === 'plus' || hasPlus || hasAnalysis) return 'plus';
  return 'free';
}

function isPersonaUnlocked(personaKey: string, tier: 'free' | 'plus' | 'elite'): boolean {
  const required = PERSONA_TIER[personaKey] ?? 'elite';
  return TIER_RANK[tier] >= TIER_RANK[required];
}

// v3 (2026-09-15) : note sur 100 (somme de 3 sous-critères précis, plus de
// moyenne /10) + vérification préalable que la photo montre la tenue
// complète — condition d'équité pour comparer les scores entre utilisateurs
// dans un classement (cf. Output/2026-09-15_prompt-analyse-ia-v3-note-sur-100.md).
function buildPrompt(personaText: string): string {
  return `Tu es un critique de mode haute couture — analytique, impartial, sans complaisance. Ton attitude pour cette analyse est définie ainsi : ${personaText} Ce ton doit transparaître dans la façon dont tu formules tes analyses, points forts et axes d'amélioration — mais applique dans tous les cas les barèmes de notation ci-dessous à l'identique, pour que les notes restent comparables entre utilisateurs quelle que soit la personnalité. Évalue uniquement ce qui est VISIBLE sur la photo.

VÉRIFICATION PRÉALABLE — PHOTO COMPLÈTE (obligatoire, avant toute notation) :
Vérifie que la photo montre la tenue de façon complète : au minimum des épaules jusqu'aux
genoux, idéalement jusqu'aux pieds. Si la photo ne montre qu'un buste, un visage, ou une
partie trop réduite de la tenue pour juger l'ensemble, mets "photo_complete": false,
explique brièvement pourquoi dans "raison_incomplete", et NE CALCULE AUCUNE NOTE (les 3
scores doivent valoir null). Cette règle garantit que tous les utilisateurs sont jugés à
égalité dans le classement — une photo incomplète avantagerait ou pénaliserait injustement
par rapport aux autres.

CALIBRAGE : base ton jugement sur ta connaissance générale des tenues largement reconnues
comme réussies (mode de rue, éditos, tendances) — pas sur une simple checklist mécanique.
Ne cite JAMAIS de marque, d'article ou de source précise inventée.

GESTION DU CADRAGE ET DE LA VISIBILITÉ : si un élément secondaire n'est pas visible à cause
du cadrage ou de la lumière (ex : chaussures partiellement masquées), n'applique aucun malus
ni bonus sur cet élément précis et concentre-toi sur ce qui est clairement identifiable.
Ne pénalise pas la qualité de la photo elle-même (luminosité, netteté).

RÈGLE DE SPÉCIFICITÉ (obligatoire) : chaque analyse, point fort ou axe d'amélioration DOIT
citer un élément concret et visible sur LA PHOTO (une couleur précise, un vêtement précis
comme "ce jean baggy", un accessoire). Interdiction des formules génériques. Si tu ne peux
pas être spécifique sur un point, ne le mentionne pas.

NOTATION SUR 100 — trois critères, chacun avec des sous-points précis qui s'additionnent.
Les fourchettes sont un guide de calibrage selon la gravité réelle observée, pas un barème
à appliquer mécaniquement au chiffre près.

CRITÈRE 1 — HARMONIE COULEURS & MATIÈRES (34 points, départ à 34)
• Trop de couleurs non neutres qui se dispersent (plus de 3, hors noir/blanc/gris/beige) : -3 à -10 pts
• Couleurs qui se heurtent (conflit chaud/froid, saturations qui jurent) : -3 à -10 pts
• Monochrome plat sans variation de texture : -3 à -6 pts
• Matières qui ne vont pas ensemble : -3 à -6 pts
Minimum : 0.

CRITÈRE 2 — COUPE & SILHOUETTE (33 points, départ à 0)
• Volumes équilibrés haut/bas : +5 à +13 pts
• Ligne de taille marquée (French tuck, ceinture, crop top) : +3 à +7 pts
• Tombé et longueurs impeccables : +3 à +7 pts
• Type de coupe maîtrisé (oversized assumé, slim net, regular propre) : +3 à +6 pts

CRITÈRE 3 — STYLE & FINITIONS (33 points, départ à 0)
• Layering cohérent : +5 à +10 pts
• Accessoire présent et pertinent : +2 pts par accessoire, max +10 pts
• Chaussures cohérentes avec le style global : +5 à +10 pts
• Vêtement visible froissé ou taché : -3 à -6 pts

CRITÈRE STYLES (obligatoire, sauf si photo_complete est false) :
Choisis exactement 1 ou 2 styles parmi cette liste — ne jamais inventer d'autres valeurs :
#StreetwearOversize #Athleisure #CasualChic #Gorpcore #Y2K #IndieSleaze #Blokecore #EclectiqueGrandpa #CleanLook #OfficeSiren #QuietLuxury #MinimalismeScandinave #AcubiStyle #SubversiveBasics #Techwear #DarkMode #Cottagecore #FairyGrunge #BohemeChic #Coquette

Réponds EXCLUSIVEMENT en JSON valide sans markdown :
{
  "photo_complete": true,
  "raison_incomplete": null,
  "couleurs_note": 0,
  "couleurs_analyse": "...",
  "coupe_note": 0,
  "coupe_analyse": "...",
  "style_note": 0,
  "style_analyse": "...",
  "points_forts": ["...", "..."],
  "axes_amelioration": ["...", "..."],
  "styles": ["#CasualChic"]
}

Règles de contenu :
- couleurs_analyse / coupe_analyse / style_analyse : 1 phrase concise (12-20 mots max), qui cite au moins un élément visuel précis.
- points_forts / axes_amelioration : 2 à 3 éléments (5-8 mots max chacun), ancrés dans un détail visible.
- Si photo_complete est false, laisse tous les champs de notation/analyse à null et n'inclus pas "styles".`;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Analyse via Google Gemini (préféré) ──────────────────────────────────────
async function analyzeWithGemini(base64Image: string, prompt: string): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY absente');

  const mimeMatch = base64Image.match(/^data:(image\/[^;]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const base64Data = base64Image.replace(/^data:image\/[^;]+;base64,/, '');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mimeType, data: base64Data } },
            { text: prompt },
          ],
        }],
        // thinkingBudget:0 désactive le raisonnement (2.5 = modèle "thinking") →
        // tout le budget de tokens va à la sortie JSON, réponse rapide.
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 1500,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Réponse Gemini vide');
  return text;
}

// ── Repli : Groq Llama 4 Scout vision ────────────────────────────────────────
async function analyzeWithGroq(base64Image: string, prompt: string): Promise<string> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY absente');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 900,
      temperature: 0.8,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: base64Image } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Réponse Groq vide');
  return text;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Non authentifié' }, 401);

  try {
    const body = await req.json().catch(() => null);
    const { base64Image, personality } = body ?? {};
    if (!base64Image || typeof base64Image !== 'string') {
      return json({ error: 'base64Image manquant ou invalide' }, 400);
    }
    if (base64Image.length > 10_000_000) {
      return json({ error: 'Image trop grande (max 7,5 Mo)' }, 400);
    }
    const VALID_PREFIXES = ['data:image/jpeg;base64,', 'data:image/png;base64,', 'data:image/webp;base64,'];
    if (!VALID_PREFIXES.some(p => base64Image.startsWith(p))) {
      return json({ error: 'Format image invalide (jpeg/png/webp requis)' }, 400);
    }
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) return json({ error: 'Session invalide ou expirée' }, 401);

    // Résolution de la personnalité : clé fermée (jamais de texte libre client), et
    // toujours vérifiée contre le tier réel de l'utilisateur — un client modifié qui
    // enverrait directement une clé Elite en étant Gratuit retombe sur DEFAULT_PERSONALITY.
    const [{ data: profileRow }, { data: subRow }] = await Promise.all([
      supabaseClient.from('profiles').select('has_ootd_plus_pass, has_analysis_pass').eq('id', user.id).single(),
      supabaseClient.from('subscriptions').select('status, plan_type').eq('user_id', user.id).maybeSingle(),
    ]);
    const tier = resolveTier(subRow ?? null, !!profileRow?.has_ootd_plus_pass, !!profileRow?.has_analysis_pass);
    const personaKey = (typeof personality === 'string' && PERSONALITIES[personality] && isPersonaUnlocked(personality, tier))
      ? personality
      : DEFAULT_PERSONALITY;
    const prompt = buildPrompt(PERSONALITIES[personaKey]);

    // Rate-limit : max 5 requêtes/minute (protection indépendante des crédits)
    const { data: rateLimitOk, error: rateErr } = await supabaseClient.rpc(
      'check_analyze_rate_limit',
      { p_max_per_minute: 5 },
    );
    if (rateErr || !rateLimitOk) {
      return json({ error: 'Trop de requêtes, réessaie dans une minute' }, 429);
    }

    // Gemini en priorité ; repli automatique sur Groq si Gemini échoue
    // (clé absente, quota épuisé, modèle indisponible…). Garantit que l'analyse
    // continue de fonctionner pendant la bascule vers Gemini. Volontairement
    // AVANT consume_daily_credit (voir plus bas) : le rate-limit protège déjà
    // contre l'abus d'appel IA, et facturer un crédit ne doit arriver qu'après
    // avoir confirmé que la photo est effectivement notable.
    let text: string;
    let provider = 'gemini';
    try {
      text = await analyzeWithGemini(base64Image, prompt);
    } catch (gemErr) {
      console.warn('[analyze-outfit] Gemini KO, repli Groq:', gemErr instanceof Error ? gemErr.message : gemErr);
      provider = 'groq';
      text = await analyzeWithGroq(base64Image, prompt);
    }

    const clean = text.replace(/```json|```/g, '').trim();
    const raw = JSON.parse(clean);

    // Photo incomplète : aucun crédit consommé, aucun score calculé — erreur
    // de cadrage côté utilisateur, pas une mauvaise analyse à faire payer.
    if (raw.photo_complete === false) {
      return json({
        photo_complete: false,
        raison_incomplete: (typeof raw.raison_incomplete === 'string' && raw.raison_incomplete.trim())
          || 'Photo incomplète : reprends une photo qui montre ta tenue en entier, des épaules aux genoux minimum.',
        provider,
      }, 200);
    }

    // Validation de la structure stricte renvoyée par l'IA
    const notes = [raw.couleurs_note, raw.coupe_note, raw.style_note];
    const analyses = [raw.couleurs_analyse, raw.coupe_analyse, raw.style_analyse];
    if (!notes.every(n => typeof n === 'number')) return json({ error: 'Notes IA manquantes ou invalides' }, 502);
    if (!analyses.every(s => typeof s === 'string' && s.trim().length > 0)) return json({ error: 'Analyses IA manquantes' }, 502);

    // Note sur 100 (v3) : chaque sous-critère a son propre plafond (34/33/33),
    // le global est la SOMME directe — plus de division par 3, les 3 critères
    // totalisent déjà 100.
    const clampTo = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));
    const harmonie = clampTo(raw.couleurs_note, 34); // CRITÈRE 1 → couleurs
    const fit = clampTo(raw.coupe_note, 33);         // CRITÈRE 2 → coupe
    const detail = clampTo(raw.style_note, 33);      // CRITÈRE 3 → style/effort
    const global = harmonie + fit + detail;

    // Crédit consommé seulement maintenant : la photo est confirmée notable et
    // le JSON valide. Effet de bord positif : un JSON malformé ou une
    // exception plus haut ne brûle plus de crédit non plus (avant, le crédit
    // était décompté avant même l'appel IA, sans possibilité de rollback).
    const { data: creditResult, error: creditError } = await supabaseClient.rpc(
      'consume_daily_credit',
      { p_user_id: user.id },
    );
    if (creditError || !creditResult?.ok) {
      const msg = creditResult?.error ?? 'Plus d\'analyses disponibles aujourd\'hui';
      return json({ error: msg, credits: creditResult?.credits ?? 0 }, 403);
    }

    // Structurer les points forts et axes d'amélioration (avec fallback si l'IA ne les retourne pas)
    const pts: string[] = (Array.isArray(raw.points_forts) && raw.points_forts.every((x: unknown) => typeof x === 'string') && raw.points_forts.length > 0)
      ? raw.points_forts.slice(0, 4)
      : [`Harmonie des couleurs (${harmonie}/34)`, `Coupe et silhouette (${fit}/33)`, `Effort de style (${detail}/33)`];
    const axes: string[] = (Array.isArray(raw.axes_amelioration) && raw.axes_amelioration.every((x: unknown) => typeof x === 'string') && raw.axes_amelioration.length > 0)
      ? raw.axes_amelioration.slice(0, 4)
      : ['Travailler les proportions et volumes', 'Soigner les accessoires et finitions'];

    const VALID_STYLES = new Set([
      '#StreetwearOversize', '#Athleisure', '#CasualChic', '#Gorpcore', '#Y2K',
      '#IndieSleaze', '#Blokecore', '#EclectiqueGrandpa', '#CleanLook', '#OfficeSiren',
      '#QuietLuxury', '#MinimalismeScandinave', '#AcubiStyle', '#SubversiveBasics',
      '#Techwear', '#DarkMode', '#Cottagecore', '#FairyGrunge', '#BohemeChic', '#Coquette',
    ]);
    const styles: string[] = Array.isArray(raw.styles)
      ? raw.styles.filter((s: unknown) => typeof s === 'string' && VALID_STYLES.has(s as string)).slice(0, 2)
      : [];

    // conseil stocké en JSON pour un affichage structuré côté client (rétrocompat : ancien = texte brut)
    const conseil = JSON.stringify({ points_forts: pts, axes_amelioration: axes });

    return json({
      global,
      fit,
      harmonie,
      detail,
      explications: {
        fit: raw.coupe_analyse.trim(),
        harmonie: raw.couleurs_analyse.trim(),
        detail: raw.style_analyse.trim(),
      },
      conseil,
      styles,
      // Structure brute stricte également exposée (couleurs_note/analyse, etc.)
      ...raw,
      provider,
      credits_remaining: creditResult.credits,
      max_credits: creditResult.max_credits,
    }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur interne' }, 500);
  }
});
