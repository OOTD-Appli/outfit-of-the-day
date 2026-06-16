import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ORIGIN = Deno.env.get('APP_ORIGIN') ?? '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Modèle Gemini. 2.5-flash dispose du quota sur la clé fournie (2.0-flash = 0).
const GEMINI_MODEL = 'gemini-2.5-flash';

const PROMPT = `Tu es un critique de mode haute couture — analytique, impartial, sans complaisance. Évalue uniquement ce qui est VISIBLE sur la photo. Utilise toute l'échelle 0–10 (outfit basique/négligé = 2–4 ; correct sans recherche = 5).

CRITÈRE 1 — HARMONIE COULEURS & MATIÈRES (départ 10/10)
• −3 pts : plus de 3 couleurs non neutres (hors noir/blanc/gris/beige)
• −2 pts : couleurs saturées incompatibles (conflit chaud/froid brutal)
• −2 pts : monochrome plat sans variation de texture ou de volume
• −2 pts : matières incompatibles (ex : lin d'été + grosse laine, satin + polaire)
Score minimum : 0.

CRITÈRE 2 — COUPE & SILHOUETTE (départ 0/10)
• +4 pts : volumes équilibrés haut/bas (ample+ajusté ou inverse)
• +2 pts : ligne de taille marquée (French tuck, vêtement rentré, ceinture, crop top)
• +2 pts : tombé et longueurs impeccables (ni trop long ni trop court)
• +2 pts : type de coupe maîtrisé (oversized assumé, slim net, regular propre)

CRITÈRE 3 — STYLE & FINITIONS (départ 0/10)
• +3 pts : layering cohérent (superposition de couches)
• +1 pt chacun : accessoire présent et pertinent (bijoux, sac, couvre-chef/lunettes, ceinture) — max 4 pts
• +3 pts : chaussures cohérentes avec le style global
• −2 pts : vêtement visible froissé ou taché

CRITÈRE STYLES (obligatoire) :
Choisis exactement 1 ou 2 styles parmi cette liste — ne jamais inventer d'autres valeurs :
#StreetwearOversize #Athleisure #CasualChic #Gorpcore #Y2K #IndieSleaze #Blokecore #EclectiqueGrandpa #CleanLook #OfficeSiren #QuietLuxury #MinimalismeScandinave #AcubiStyle #SubversiveBasics #Techwear #DarkMode #Cottagecore #FairyGrunge #BohemeChic #Coquette

Réponds EXCLUSIVEMENT en JSON valide sans markdown ni balises :
{"couleurs_note":0,"couleurs_analyse":"...","coupe_note":0,"coupe_analyse":"...","style_note":0,"style_analyse":"...","points_forts":["...","..."],"axes_amelioration":["...","..."],"styles":["#CasualChic"]}

Règles de contenu :
- couleurs_analyse / coupe_analyse / style_analyse : 1 phrase concise (10–15 mots max).
- points_forts : 2 à 3 éléments positifs notables (5–8 mots max chacun).
- axes_amelioration : 2 à 3 pistes d'amélioration concrètes (5–8 mots max chacun).
- styles : tableau de 1 ou 2 hashtags exacts issus de la liste ci-dessus, jamais 0, jamais plus de 2.`;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Analyse via Google Gemini (préféré) ──────────────────────────────────────
async function analyzeWithGemini(base64Image: string): Promise<string> {
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
            { text: PROMPT },
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
async function analyzeWithGroq(base64Image: string): Promise<string> {
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
          { type: 'text', text: PROMPT },
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
    const { base64Image } = body ?? {};
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

    // Rate-limit : max 5 requêtes/minute (protection indépendante des crédits)
    const { data: rateLimitOk, error: rateErr } = await supabaseClient.rpc(
      'check_analyze_rate_limit',
      { p_max_per_minute: 5 },
    );
    if (rateErr || !rateLimitOk) {
      return json({ error: 'Trop de requêtes, réessaie dans une minute' }, 429);
    }

    const { data: creditResult, error: creditError } = await supabaseClient.rpc(
      'consume_daily_credit',
      { p_user_id: user.id },
    );
    if (creditError || !creditResult?.ok) {
      const msg = creditResult?.error ?? 'Plus d\'analyses disponibles aujourd\'hui';
      return json({ error: msg, credits: creditResult?.credits ?? 0 }, 403);
    }

    // Gemini en priorité ; repli automatique sur Groq si Gemini échoue
    // (clé absente, quota épuisé, modèle indisponible…). Garantit que l'analyse
    // continue de fonctionner pendant la bascule vers Gemini.
    let text: string;
    let provider = 'gemini';
    try {
      text = await analyzeWithGemini(base64Image);
    } catch (gemErr) {
      console.warn('[analyze-outfit] Gemini KO, repli Groq:', gemErr instanceof Error ? gemErr.message : gemErr);
      provider = 'groq';
      text = await analyzeWithGroq(base64Image);
    }

    const clean = text.replace(/```json|```/g, '').trim();
    const raw = JSON.parse(clean);

    // Validation de la structure stricte renvoyée par l'IA
    const notes = [raw.couleurs_note, raw.coupe_note, raw.style_note];
    const analyses = [raw.couleurs_analyse, raw.coupe_analyse, raw.style_analyse];
    if (!notes.every(n => typeof n === 'number')) return json({ error: 'Notes IA manquantes ou invalides' }, 502);
    if (!analyses.every(s => typeof s === 'string' && s.trim().length > 0)) return json({ error: 'Analyses IA manquantes' }, 502);

    const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n)));
    const harmonie = clamp(raw.couleurs_note); // CRITÈRE 1 → couleurs
    const fit = clamp(raw.coupe_note);         // CRITÈRE 2 → coupe
    const detail = clamp(raw.style_note);      // CRITÈRE 3 → style/effort
    // Moyenne globale calculée mathématiquement côté serveur
    const global = Math.round((harmonie + fit + detail) / 3);

    // Structurer les points forts et axes d'amélioration (avec fallback si l'IA ne les retourne pas)
    const pts: string[] = (Array.isArray(raw.points_forts) && raw.points_forts.every((x: unknown) => typeof x === 'string') && raw.points_forts.length > 0)
      ? raw.points_forts.slice(0, 4)
      : [`Harmonie des couleurs (${harmonie}/10)`, `Coupe et silhouette (${fit}/10)`, `Effort de style (${detail}/10)`];
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
