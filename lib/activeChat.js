// Singleton léger : retient la conversation actuellement ouverte (id de l'ami).
// Permet à la bannière in-app (InAppBanner) de ne PAS s'afficher quand on est
// déjà dans la conversation concernée. Volontairement hors React (pas de
// re-render) — c'est une simple coordination entre composants distants.

let activeFriendId = null;

export function setActiveChat(friendId) {
  activeFriendId = friendId || null;
}

export function getActiveChat() {
  return activeFriendId;
}
