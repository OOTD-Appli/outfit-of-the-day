import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

// Handle web platform - notifications may not be available
const isWeb = Platform.OS === 'web';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications() {
  // Return null for web platform as notifications aren't supported the same way
  if (Platform.OS === 'web') {
    console.log('Push notifications not supported on web');
    return null;
  }

  if (!Device.isDevice) {
    console.warn('[notifications] Push notifications nécessitent un vrai téléphone.');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[notifications] Permission notifications refusée.');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#ED93B1',
    });
  }

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  return token;
}

export async function savePushToken(token) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from('profiles_private')
    .upsert({ id: user.id, push_token: token }, { onConflict: 'id' });
}

// ── Rappel quotidien « Flammes » (notification locale, natif uniquement) ─────
// Sur web/PWA, les notifications locales planifiées ne sont pas fiables (pas de
// tâche de fond) → il faudrait un cron serveur + push. Ici : natif (Expo).
const FLAMME_REMINDER_ID = 'ootd-flamme-reminder';

export async function scheduleFlammeReminder(hour = 19, minute = 0) {
  if (isWeb) return; // non supporté de façon fiable sur PWA
  try {
    // Évite les doublons : on annule l'éventuel rappel existant avant de replanifier
    await Notifications.cancelScheduledNotificationAsync(FLAMME_REMINDER_ID).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: FLAMME_REMINDER_ID,
      content: {
        title: 'OOTD',
        body: 'Il est temps de prendre ta photo pour tes flammes ! 🔥',
        data: { url: '/?analyse=1' },
      },
      trigger: { hour, minute, repeats: true },
    });
  } catch (e) {
    console.log('[notifications] scheduleFlammeReminder', e?.message || e);
  }
}

// Annule complètement le rappel planifié (ex: déconnexion)
export async function cancelFlammeReminder() {
  if (isWeb) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(FLAMME_REMINDER_ID);
  } catch (_) {}
}

// Efface le rappel AFFICHÉ dans le centre de notif (l'utilisateur vient d'envoyer
// sa photo) — sans toucher à la planification quotidienne.
export async function dismissDeliveredFlammeReminder() {
  if (isWeb) return;
  try {
    await Notifications.dismissNotificationAsync(FLAMME_REMINDER_ID);
  } catch (_) {}
}

export async function sendPushNotification(token, title, body) {
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      sound: 'default',
      title,
      body,
    }),
  });
}
