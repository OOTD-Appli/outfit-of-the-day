// Post-build : injecte les balises PWA dans dist/index.html (manifest, apple-touch-icon,
// meta). Plus fiable que l'injection runtime pour déclencher l'installabilité.
const fs = require('fs');
const path = require('path');

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

const tags = [
  '<link rel="manifest" href="/manifest.webmanifest" />',
  '<link rel="apple-touch-icon" href="/icon-192.png" />',
  '<meta name="theme-color" content="#ED93B1" />',
  '<meta name="mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-capable" content="yes" />',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />',
  '<meta name="apple-mobile-web-app-title" content="OOTD" />',
].join('\n    ');

if (html.includes('</head>')) {
  html = html.replace('</head>', `    ${tags}\n  </head>`);
  fs.writeFileSync(file, html);
  console.log('[inject-pwa] balises PWA injectées dans index.html');
} else {
  console.warn('[inject-pwa] balise </head> introuvable — injection ignorée');
}
