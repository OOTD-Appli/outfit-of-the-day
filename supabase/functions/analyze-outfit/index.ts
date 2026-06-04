import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Modèle Gemini. 2.5-flash dispose du quota sur la clé fournie (2.0-flash = 0).
const GEMINI_MODEL = 'gemini-2.5-flash';

const PROMPT = `Tu es un critique de mode de haute couture, froid, analytique, impartial et extrêmement strict. Ton rôle est d'évaluer la photo d'un outfit sans aucune complaisance ni politesse artificielle. Tu dois utiliser l'intégralité de l'échelle de notation de 1 à 10. Si un outfit est basique ou négligé, sa note doit être basse (entre 2 et 4). Si un outfit est correct mais sans recherche, sa note doit être de 5. Pour chaque critère, applique rigoureusement le barème suivant :

- CRITÈRE 1: HARMONIE DES COULEURS (Départ à 10/10). Enlève 3 points si plus de 3 couleurs non neutres (hors noir, blanc, gris). Enlève 2 points si conflit de couleurs saturées incompatibles. Enlève 2 points si monochrome total plat et sans relief de texture.
- CRITÈRE 2: COUPE ET SILHOUETTE (Départ à 0/10). Donne 4 points si les volumes sont équilibrés (ample/ajusté ou ajusté/ample), sinon 0. Donne 3 points si la ligne de taille est marquée (vêtement rentré, ceinture, crop). Donne 3 points si le tombé et les longueurs sont impeccables.
- CRITÈRE 3: EFFORT DE STYLE (Départ à 0/10). Donne 3 points si présence de layering (superposition). Donne jusqu'à 4 points pour les accessoires (1pt par catégorie : bijoux, sac, couvre-chef/lunettes, détails/chaussettes). Donne 3 points si les chaussures sont parfaitement cohérentes avec le style global.

N'évalue que ce qui est VISIBLE sur la photo. N'invente aucun élément non visible.
Réponds EXCLUSIVEMENT en JSON valide (sans markdown), à la structure exacte :
{"couleurs_note": 0, "couleurs_analyse": "...", "coupe_note": 0, "coupe_analyse": "...", "style_note": 0, "style_analyse": "..."}`;

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
          maxOutputTokens: 1024,
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
      max_tokens: 500,
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

    // Mapping vers la structure attendue par le client et la DB
    // (score_couleurs=harmonie, score_coupe=fit, score_tendance=detail).
    const conseil =
      `Couleurs (${harmonie}/10) : ${raw.couleurs_analyse.trim()} ` +
      `Coupe (${fit}/10) : ${raw.coupe_analyse.trim()} ` +
      `Style (${detail}/10) : ${raw.style_analyse.trim()}`;

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
