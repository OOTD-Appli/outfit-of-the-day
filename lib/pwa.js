// PWA — version native : no-op (le runtime web utilise lib/pwa.web.js).
export function setupPwa() {}
export async function requestWebNotificationPermission() { return 'unsupported'; }
export function isPwaStandalone() { return false; }
export function canInstallPwa() { return false; }
export async function promptInstall() { return false; }
