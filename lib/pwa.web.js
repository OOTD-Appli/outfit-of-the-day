// PWA (web) : manifest + meta tags, service worker, permission notifications,
// et bannière d'installation (capture de `beforeinstallprompt` + astuce iOS).

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

let deferredPrompt = null;

function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch (_) { return false; }
}

function dismissed() {
  try { return localStorage.getItem('ootd_install_dismissed') === '1'; } catch (_) { return false; }
}
function setDismissed() {
  try { localStorage.setItem('ootd_install_dismissed', '1'); } catch (_) {}
}

function removeBanner() {
  const b = document.getElementById('ootd-install-banner');
  if (b) b.remove();
}

// API exposée à l'UI (bouton « Télécharger l'app » du Profil)
export function isPwaStandalone() { return isStandalone(); }
export function canInstallPwa() { return !!deferredPrompt && !isStandalone(); }
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const p = deferredPrompt;
  deferredPrompt = null;
  removeBanner();
  p.prompt();
  try { await p.userChoice; } catch (_) {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ootd-pwa-change'));
  return true;
}

function buildBanner(innerHtml) {
  removeBanner();
  const banner = document.createElement('div');
  banner.id = 'ootd-install-banner';
  banner.style.cssText = [
    'position:fixed', 'left:12px', 'right:12px', 'bottom:12px', 'z-index:2147483000',
    'display:flex', 'align-items:center', 'gap:12px', 'padding:12px 14px',
    'background:#121218', 'color:#fff', 'border:1px solid #2a2a33', 'border-radius:16px',
    'box-shadow:0 10px 30px rgba(0,0,0,.45)', 'font-family:system-ui,-apple-system,sans-serif',
    'max-width:460px', 'margin:0 auto',
  ].join(';');
  banner.innerHTML = innerHtml;
  document.body.appendChild(banner);
  return banner;
}

function showInstallBanner() {
  if (dismissed() || isStandalone()) return;
  const banner = buildBanner(
    '<img src="/icon-192.png" alt="" style="width:42px;height:42px;border-radius:11px"/>' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-weight:800;font-size:15px">Installer OOTD</div>' +
    '<div style="font-size:12px;color:#9aa">Ajoute l\'app à ton écran d\'accueil</div></div>' +
    '<button id="ootd-install-btn" style="background:#ED93B1;color:#fff;border:none;border-radius:11px;padding:10px 15px;font-weight:800;font-size:13px;cursor:pointer">Installer</button>' +
    '<button id="ootd-install-close" aria-label="Fermer" style="background:transparent;color:#9aa;border:none;font-size:22px;line-height:1;cursor:pointer;padding:0 2px">&times;</button>',
  );
  banner.querySelector('#ootd-install-btn').addEventListener('click', async () => {
    removeBanner();
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (_) {}
    deferredPrompt = null;
  });
  banner.querySelector('#ootd-install-close').addEventListener('click', () => { removeBanner(); setDismissed(); });
}

function showIosHint() {
  if (dismissed() || isStandalone()) return;
  const banner = buildBanner(
    '<img src="/icon-192.png" alt="" style="width:42px;height:42px;border-radius:11px"/>' +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-weight:800;font-size:15px">Installer OOTD</div>' +
    '<div style="font-size:12px;color:#9aa">Appuie sur <b>Partager</b> puis <b>« Sur l\'écran d\'accueil »</b></div></div>' +
    '<button id="ootd-install-close" aria-label="Fermer" style="background:transparent;color:#9aa;border:none;font-size:22px;line-height:1;cursor:pointer;padding:0 2px">&times;</button>',
  );
  banner.querySelector('#ootd-install-close').addEventListener('click', () => { removeBanner(); setDismissed(); });
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

  // Bannière d'installation (Chrome/Edge/Android) : on capte le prompt natif
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showInstallBanner();
    window.dispatchEvent(new Event('ootd-pwa-change'));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    removeBanner();
    setDismissed();
    window.dispatchEvent(new Event('ootd-pwa-change'));
  });

  // iOS Safari ne déclenche pas beforeinstallprompt → astuce manuelle
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
  if (isIos && !isStandalone()) {
    setTimeout(showIosHint, 2500);
  }

  // Permission notifications : demandée au 1er clic (exigence "user gesture")
  const askOnce = () => {
    document.removeEventListener('click', askOnce);
    requestWebNotificationPermission();
  };
  document.addEventListener('click', askOnce, { once: true });
}
