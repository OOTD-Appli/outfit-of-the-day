import { registerRootComponent } from 'expo';

import App from './App';
import { setupPwa } from './lib/pwa';

registerRootComponent(App);

// Initialise la PWA sur le web (manifest, service worker, notifications) ; no-op sur natif.
setupPwa();
