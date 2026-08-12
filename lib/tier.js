// Détection de tier (Gratuit / Plus / Elite) — helper partagé entre ShopScreen,
// ProfilScreen et AccueilScreen pour ne pas dupliquer la logique d'abonnement.
// Source de vérité métier : Cahier des charges Monétisation OOTD (2026-08-12).

export const TIER_RANK = { free: 0, plus: 1, elite: 2 };

export function getSubActive(subscription) {
  return !!(subscription && ['active', 'trialing'].includes(subscription.status));
}

export function getActivePlan(subscription) {
  return getSubActive(subscription) ? subscription.plan_type : null;
}

// Tier global de l'utilisateur pour les crédits IA et les personnalités IA.
// hasPlus/hasAnalysis = passes legacy (profiles.has_ootd_plus_pass / has_analysis_pass),
// équivalents Plus pour les crédits quotidiens (cf. consume_daily_credit côté serveur) —
// mais PAS équivalents Elite (contrairement à has_ootd_plus_pass pour les cosmétiques,
// une nuance propre à ShopScreen qui reste locale à cet écran).
export function resolveTier({ subscription, hasPlus = false, hasAnalysis = false } = {}) {
  const activePlan = getActivePlan(subscription);
  if (activePlan === 'elite') return 'elite';
  if (activePlan === 'plus' || hasPlus || hasAnalysis) return 'plus';
  return 'free';
}

export function tierAtLeast(tier, required) {
  return (TIER_RANK[tier] ?? 0) >= (TIER_RANK[required] ?? 0);
}

export function tierLabel(tier) {
  return tier === 'elite' ? 'Elite' : tier === 'plus' ? 'Plus' : 'Gratuit';
}

// Personnalités du critique IA — clés strictement synchronisées avec
// supabase/functions/analyze-outfit (PERSONALITIES) et la contrainte CHECK
// profiles_analysis_personality_valid. Toute modification doit être répercutée
// aux deux endroits.
export const PERSONA_TIER = {
  coach: 'free',
  bienveillant: 'plus',
  pote_hype: 'elite',
  fashion_week: 'elite',
  streetwear: 'elite',
};

export const DEFAULT_PERSONA = 'coach';

export function isPersonaUnlocked(personaKey, tier) {
  return tierAtLeast(tier, PERSONA_TIER[personaKey] || 'elite');
}
