// Web Push — version native : no-op (le push natif passe par Expo Push).
export async function registerWebPush() {}

// Désabonnement web push — no-op natif (la gestion passe par Expo Notifications).
export async function unsubscribeWebPush() {}

// Effacement des notifications d'une conversation — no-op natif
// (la gestion native passe par Expo Notifications, cf. lib/notifications.js).
export async function dismissChatNotifications() {}
