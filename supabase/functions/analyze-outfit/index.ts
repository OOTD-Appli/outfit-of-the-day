import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CRITERIA_KEYS = ['fit', 'harmonie', 'detail'];

const PROMPT = `Tu es un styliste-conseiller expert. Analyse uniquement ce qui est VISIBLE sur la photo.

Barème (notes entières de 1 à 10):
- global: impression générale de la tenue
- fit: précision de la coupe sur le corps, proportion, tombé
- harmonie: équilibre des couleurs, matières et textures
- detail: soin des finitions et accessoires visibles

Contraintes:
- Les notes doivent être variées et réalistes (évite les mêmes notes partout)
- N'utilise 9-10 que pour une tenue vraiment remarquable
- Le conseil doit être ultra concret, actionnable, et lié à cette photo
- N'invente pas des éléments non visibles
- Explique brièvement pourquoi chaque note a été donnée (1 phrase par critère)
- Le conseil doit être structuré en 2 parties: "Ce qui marche" puis "À essayer"

Réponds UNIQUEMENT en JSON valide (sans markdown) au format exact:
{"global": 6, "fit": 7, "harmonie": 6, "detail": 6, "explications": {"fit": "explication", "harmonie": "explication", "detail": "explication"}, "conseil": "Ce qui marche: ... À essayer: ..."}`;

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
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

    const groqApiKey = Deno.env.get('GROQ_API_KEY');
    if (!groqApiKey) {
      return json({ error: 'Clé API Groq non configurée sur le serveur' }, 500);
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${groqApiKey}`,
      },
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

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      return json({ error: `Groq ${groqRes.status}: ${errText}` }, 502);
    }

    const groqData = await groqRes.json();
    const text = groqData?.choices?.[0]?.message?.content;
    if (!text) return json({ error: 'Réponse IA invalide' }, 502);

    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    if (typeof parsed.global !== 'number') return json({ error: 'Analyse IA incomplète' }, 502);
    if (!CRITERIA_KEYS.every(k => typeof parsed[k] === 'number')) return json({ error: 'Analyse IA invalide' }, 502);
    if (!CRITERIA_KEYS.every(k => typeof parsed?.explications?.[k] === 'string')) return json({ error: 'Explications manquantes' }, 502);
    if (typeof parsed.conseil !== 'string' || parsed.conseil.trim().length < 40) return json({ error: 'Conseil trop court' }, 502);

    return json({
      ...parsed,
      credits_remaining: creditResult.credits,
      max_credits: creditResult.max_credits,
    }, 200);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Erreur interne' }, 500);
  }
});
