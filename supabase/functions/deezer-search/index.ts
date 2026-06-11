// OOTD — Edge Function : deezer-search
// Proxy CORS-safe vers l'API publique Deezer (api.deezer.com n'envoie pas
// d'en-têtes CORS → un fetch direct depuis la PWA échoue). Renvoie une liste
// normalisée { title, artist, previewUrl, coverUrl } (preview = extrait 30s mp3).
//
// `supabase functions deploy deezer-search --no-verify-jwt`

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ORIGIN = Deno.env.get('APP_ORIGIN') ?? '*';
const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = new URL(req.url);
    let q = url.searchParams.get('q') || '';
    if (!q && req.method === 'POST') {
      const body = await req.json().catch(() => null);
      q = body?.q || '';
    }
    q = q.trim();
    if (q.length < 2) return json({ results: [] });

    const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=12`);
    if (!res.ok) return json({ results: [], error: `Deezer ${res.status}` }, 200);
    const data = await res.json();

    const results = (data?.data ?? [])
      .filter((t: any) => t?.preview) // garde uniquement les pistes avec extrait 30s
      .slice(0, 10)
      .map((t: any) => ({
        id: t.id,
        title: t.title_short || t.title,
        artist: t.artist?.name || '',
        previewUrl: t.preview,
        coverUrl: t.album?.cover_medium || t.album?.cover || null,
      }));

    return json({ results });
  } catch (err) {
    return json({ results: [], error: err instanceof Error ? err.message : 'Erreur' }, 200);
  }
});
