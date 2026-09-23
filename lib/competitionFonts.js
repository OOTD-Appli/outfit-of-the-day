import { useFonts, Baloo2_700Bold } from '@expo-google-fonts/baloo-2';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

// Police fixe de l'aire "Compétitions" (CompetitionScreen + CompetitionsListScreen,
// palette sombre dédiée indépendante du useTheme() clair/sombre du reste de
// l'app) — reprise à l'identique de la maquette HTML validée par l'utilisateur :
// 'Baloo 2' (titres, scores, chiffres de rang — toujours en 700 dans la
// maquette) et 'Plus Jakarta Sans' (tout le reste, plusieurs graisses).
// Chaque fichier TTF étant à graisse fixe, fontWeight n'est jamais combiné
// avec ces fontFamily (sinon RN tente une fausse graisse synthétique par-dessus
// un glyphe déjà gras/normal sur certaines plateformes) — utiliser directement
// la bonne entrée FONT_BODY.<graisse> à la place.
export const FONT_DISPLAY = 'Baloo2_700Bold';
export const FONT_BODY = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
};

export function useCompetitionFonts() {
  return useFonts({
    Baloo2_700Bold,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });
}
