/* OOTD — Service Worker : offline (app shell) + notifications push. */
const CACHE = 'ootd-cache-v3';
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(APP_SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // Ne jamais intercepter les appels externes (Supabase, Stripe, Groq…)
  if (url.origin !== self.location.origin) return;

  // Navigation : réseau d'abord, repli sur le shell en cache (offline)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return res; })
        .catch(() => caches.match('/').then((r) => r || caches.match(req))),
    );
    return;
  }

  // Statiques (JS, icônes, polices) : cache d'abord, puis réseau
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => cached)),
  );
});

// Réception d'une notification push — payload JSON envoyé par l'Edge Function send-web-push.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'OOTD';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // tag : regroupe/remplace les notifs d'une même conversation (1 par chat)
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // App déjà ouverte → on la focus ET on lui transmet le deep link (sans reload)
      for (const client of list) {
        if ('focus' in client) {
          client.postMessage({ type: 'deep-link', url: target });
          return client.focus();
        }
      }
      // App fermée → on ouvre directement la bonne URL (avec ?chat=…)
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});
