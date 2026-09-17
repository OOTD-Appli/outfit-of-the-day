// Singleton léger : retient la conversation/compétition actuellement ouverte.
// Permet à la bannière in-app de ne PAS s'afficher quand on est déjà dedans.
// Volontairement hors React (pas de re-render) — simple coordination entre
// composants distants.
//
// setActiveChat/getActiveChat (1-à-1) restent le temps que FlammesScreen.js
// existe encore (nettoyage prévu en Phase 5) ; setActiveCompetition/
// getActiveCompetition sont l'équivalent pour le chat de groupe.

let activeFriendId = null;
let activeCompetitionId = null;

export function setActiveChat(friendId) {
  activeFriendId = friendId || null;
}

export function getActiveChat() {
  return activeFriendId;
}

export function setActiveCompetition(competitionId) {
  activeCompetitionId = competitionId || null;
}

export function getActiveCompetition() {
  return activeCompetitionId;
}
