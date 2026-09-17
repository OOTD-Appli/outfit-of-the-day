// Singleton léger : retient la compétition dont le chat de groupe est
// actuellement ouvert. Volontairement hors React (pas de re-render) — simple
// coordination entre composants distants (ex : suppression d'une bannière
// de notification quand on est déjà dans la conversation concernée).

let activeCompetitionId = null;

export function setActiveCompetition(competitionId) {
  activeCompetitionId = competitionId || null;
}

export function getActiveCompetition() {
  return activeCompetitionId;
}
