// Calcule le numéro de niveau à partir des points totaux
export function computeNiveau(pts) {
  let level = 1;
  let threshold = 100;
  let cumulative = 0;
  while (cumulative + threshold <= pts) {
    cumulative += threshold;
    level++;
    threshold = Math.floor(threshold * 1.8);
  }
  return level;
}

// Calcule la progression dans le niveau actuel
export function computeLevelInfo(pts) {
  let threshold = 100;
  let cumulative = 0;
  while (cumulative + threshold <= pts) {
    cumulative += threshold;
    threshold = Math.floor(threshold * 1.8);
  }
  const progressInLevel = pts - cumulative;
  const percent = Math.min(100, Math.round((progressInLevel / threshold) * 100));
  return { threshold, progressInLevel, percent };
}

// Temps relatif en français
export function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
  if (seconds < 60) return "à l'instant";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
  return `${Math.floor(seconds / 86400)} j`;
}
