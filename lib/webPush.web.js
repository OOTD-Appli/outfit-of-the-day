// Web Push (web) : souscrit le navigateur et enregistre l'abonnement en base.
// L'envoi se fait côté serveur via l'Edge Function `send-web-push` (clés VAPID).
import { supabase } from './supabase';

// Clé publique VAPID (publique par nature — la privée reste secret Supabase).
const VAPID_PUBLIC_KEY = 'BDGXSSczhcpOG9LwVx4GtAHjEcHlCEqRid1BQVBKBBA7LxfvV6E3SbszBtMFlcFTYmRtx1bQgT_VITu2ExuKjMc';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function registerWebPush() {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return;

    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const j = sub.toJSON();
    if (!j.keys || !j.keys.p256dh || !j.keys.auth) return;

    await supabase.from('web_push_subscriptions').upsert(
      { user_id: user.id, endpoint: sub.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: 'endpoint' },
    );
  } catch (_) {
    // best-effort : on n'interrompt jamais le flux applicatif
  }
}

// Ferme les notifications push d'une conversation (tag = chat-<friendId>)
// dès que l'utilisateur ouvre/lit la discussion → nettoie le centre de notif.
export async function dismissChatNotifications(friendId) {
  try {
    if (!friendId || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const notifs = await reg.getNotifications({ tag: `chat-${friendId}` });
    notifs.forEach((n) => n.close());
  } catch (_) {}
}
