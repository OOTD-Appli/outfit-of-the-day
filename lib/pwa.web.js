// PWA (web) : injecte le manifest + meta tags, enregistre le service worker,
// et demande la permission notifications au premier geste utilisateur.

export async function requestWebNotificationPermission() {
  try {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return await Notification.requestPermission();
  } catch (_) {
    return 'denied';
  }
}

export function setupPwa() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const head = document.head;

  const ensureLink = (rel, href, attrs = {}) => {
    if (document.querySelector(`link[rel="${rel}"][href="${href}"]`)) return;
    const l = document.createElement('link');
    l.rel = rel;
    l.href = href;
    Object.entries(attrs).forEach(([k, v]) => l.setAttribute(k, v));
    head.appendChild(l);
  };
  const ensureMeta = (name, content) => {
    if (document.querySelector(`meta[name="${name}"]`)) return;
    const m = document.createElement('meta');
    m.setAttribute('name', name);
    m.content = content;
    head.appendChild(m);
  };

  ensureLink('manifest', '/manifest.webmanifest');
  ensureLink('apple-touch-icon', '/icon-192.png');
  ensureMeta('theme-color', '#ED93B1');
  ensureMeta('mobile-web-app-capable', 'yes');
  ensureMeta('apple-mobile-web-app-capable', 'yes');
  ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  ensureMeta('apple-mobile-web-app-title', 'OOTD');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // Permission notifications : demandée au 1er clic (exigence "user gesture")
  const askOnce = () => {
    document.removeEventListener('click', askOnce);
    requestWebNotificationPermission();
  };
  document.addEventListener('click', askOnce, { once: true });
}
