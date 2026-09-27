// OOTD — Edge Function : deezer-search
// Proxy CORS-safe vers l'API publique Deezer (api.deezer.com n'envoie pas
// d'en-têtes CORS → un fetch direct depuis la PWA échoue). Renvoie une liste
// normalisée { title, artist, previewUrl, coverUrl } (preview = extrait 30s mp3).
//
// `supabase functions deploy deezer-search --no-verify-jwt`

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// APP_ORIGIN accepte une liste d'origines séparées par des virgules (multi-domaines :
// ancien + nouveau nom de marque, + localhost en dev) — on renvoie l'origine de la
// requête si elle y figure, jamais '*' en présence d'Authorization.
const ALLOWED_ORIGINS = (Deno.env.get('APP_ORIGIN') ?? '')
  .split(',').map((o) => o.trim()).filter(Boolean);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : (ALLOWED_ORIGINS[0] ?? '*');
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

serve(async (req: Request) => {
  const CORS = corsHeadersFor(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

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
