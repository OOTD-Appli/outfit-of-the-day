import { getLocalDayIsoRange } from './flammesUtils';

/**
 * true si l'utilisateur a déjà soumis une tenue à cette compétition aujourd'hui
 * (fuseau local) — équivalent "régularité de participation" qui remplace le
 * streak 1-à-1 (flammes). user_id/created_at sont dénormalisés sur
 * ootd_competitions, donc aucune jointure vers ootds n'est nécessaire ici.
 */
export async function hasSubmittedTodayForCompetition(supabase, competitionId, userId) {
  const { startIso, endIso } = getLocalDayIsoRange();
  const { count, error } = await supabase
    .from('ootd_competitions')
    .select('*', { count: 'exact', head: true })
    .eq('competition_id', competitionId)
    .eq('user_id', userId)
    .gte('created_at', startIso)
    .lt('created_at', endIso);
  if (error) throw error;
  return (count ?? 0) >= 1;
}
