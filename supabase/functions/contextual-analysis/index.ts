import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ORIGIN = Deno.env.get('APP_ORIGIN') ?? '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_MODEL = 'gemini-2.5-flash';

function buildPrompt(context: string): string {
  return `Tu es un expert en stylisme. Analyse la tenue visible sur la photo.

CONTEXTE FOURNI : "${context}"

Ta mission : évaluer si cette tenue est appropriée pour ce contexte précis.

Réponds EXCLUSIVEMENT en JSON valide sans markdown ni balises :
{"coherent":true,"verdict":"Oui","explication":"...","conseil":"..."}

Règles strictes :
- coherent : true si la tenue convient au contexte, false sinon.
- verdict : exactement "Oui" si coherent true, "Non" si coherent false.
- explication : 1 phrase concise (10-15 mots max) expliquant le verdict.
- conseil : 1 conseil pratique (10-15 mots max) pour améliorer ou confirmer la tenue.`;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function analyzeWithGemini(base64Image: string, context: string): Promise<string> {
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
            { text: buildPrompt(context) },
          ],
        }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 400,
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

async function analyzeWithGroq(base64Image: string, context: string): Promise<string> {
  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY absente');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 300,
      temperature: 0.4,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: base64Image } },
          { type: 'text', text: buildPrompt(context) },
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
    const { base64Image, context } = body ?? {};

    if (!base64Image || typeof base64Image !== 'string') {
      return json({ error: 'base64Image manquant ou invalide' }, 400);
    }
    if (!context || typeof context !== 'string' || context.trim().length === 0) {
      return json({ error: 'context manquant' }, 400);
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
      const msg = creditResult?.error ?? "Plus d'analyses disponibles aujourd'hui";
      return json({ error: msg, credits: creditResult?.credits ?? 0 }, 403);
    }

    let text: string;
    try {
      text = await analyzeWithGemini(base64Image, context.trim());
    } catch (gemErr) {
      console.warn('[contextual-analysis] Gemini KO, repli Groq:', gemErr instanceof Error ? gemErr.message : gemErr);
      text = await analyzeWithGroq(base64Image, context.trim());
    }

    const clean = text.replace(/```json|```/g, '').trim();
    const raw = JSON.parse(clean);

    if (typeof raw.coherent !== 'boolean') return json({ error: 'Réponse IA invalide' }, 502);

    return json({
      coherent: raw.coherent,
      verdict: raw.coherent ? 'Oui' : 'Non',
      explication: typeof raw.explication === 'string' ? raw.explication.trim() : '',
      conseil: typeof raw.conseil === 'string' ? raw.conseil.trim() : '',
      credits_remaining: creditResult.credits,
    }, 200);

  } catch (err) {
    console.error('[contextual-analysis] error:', err instanceof Error ? err.message : err);
    return json({ error: 'Erreur interne du serveur' }, 500);
  }
});
