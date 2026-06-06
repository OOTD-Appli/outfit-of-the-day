// Web Push — version native : no-op (le push natif passe par Expo Push).
export async function registerWebPush() {}

// Effacement des notifications d'une conversation — no-op natif
// (la gestion native passe par Expo Notifications, cf. lib/notifications.js).
export async function dismissChatNotifications() {}
