// Post-build : injecte les balises PWA + Open Graph dans dist/index.html (manifest,
// apple-touch-icon, meta). Plus fiable que l'injection runtime pour déclencher
// l'installabilité, et c'est le seul moyen d'avoir des balises og:*/twitter:* — Expo web
// export ne les génère pas nativement.
const fs = require('fs');
const path = require('path');

// Dupliqué depuis lib/brand.js (impossible d'y faire un require() direct : ce script
// tourne en CommonJS pur hors Metro/Babel, et lib/brand.js est un module ESM `export`).
// Garder ces 3 valeurs synchronisées avec lib/brand.js en cas de renommage.
const APP_NAME = 'FitLigue';
const APP_TAGLINE = 'Monte dans le rank';
const APP_URL = 'https://fitligue.vercel.app';

const file = path.join(__dirname, '..', 'dist', 'index.html');
if (!fs.existsSync(file)) {
  console.warn('[inject-pwa] dist/index.html introuvable — étape ignorée');
  process.exit(0);
}

let html = fs.readFileSync(file, 'utf8');

if (html.includes('rel="manifest"')) {
  console.log('[inject-pwa] manifest déjà présent, rien à faire');
  process.exit(0);
}

const description = `${APP_NAME} — ${APP_TAGLINE}. Partage et analyse tes tenues.`;

const tags = [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<link rel="apple-touch-icon" href="/icon-192.png" />',
  '<meta name="theme-color" content="#ED93B1" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  `<meta name="apple-mobile-web-app-title" content="${APP_NAME}" />`,
  // Open Graph — aperçu du lien sur WhatsApp/Insta/etc.
  `<meta property="og:title" content="${APP_NAME}" />`,
  `<meta property="og:site_name" content="${APP_NAME}" />`,
  `<meta property="og:description" content="${description}" />`,
  `<meta property="og:image" content="${APP_URL}/icon-512.png" />`,
  '<meta property="og:type" content="website" />',
  `<meta property="og:url" content="${APP_URL}" />`,
  '<meta name="twitter:card" content="summary" />',
  `<meta name="twitter:title" content="${APP_NAME}" />`,
  `<meta name="twitter:description" content="${description}" />`,
].join('\n    ');

if (html.includes('</head>')) {
  html = html.replace('</head>', `    ${tags}\n  </head>`);
  fs.writeFileSync(file, html);
  console.log('[inject-pwa] balises PWA + Open Graph injectées dans index.html');
} else {
  console.warn('[inject-pwa] balise </head> introuvable — injection ignorée');
}
