// Singleton léger (hors React, pas de re-render) : porte la tenue en
// attente entre AccueilScreen (après analyse + upload) et
// ShareToCompetitionScreen. Volontairement hors des route params : l'image
// est déjà une URL publique à ce stade (uploadAnalyzedImageIfNeeded), mais le
// reste (score, conseil, styles...) n'a pas de raison d'être sérialisé dans
// l'URL/état de navigation pour un objet qui ne vit qu'une navigation.

let pending = null;

export function setPendingOutfit(outfit) {
  pending = outfit || null;
}

export function getPendingOutfit() {
  return pending;
}

export function clearPendingOutfit() {
  pending = null;
}
