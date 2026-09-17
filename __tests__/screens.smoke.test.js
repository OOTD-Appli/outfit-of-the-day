// Filet de sécurité minimal : détecte une erreur de syntaxe/import cassée sur un
// écran avant qu'elle n'atteigne un build EAS ou une session de test manuelle.
// Ne rend rien (pas de renderer RN dans ce projet) — vérifie juste que le module
// se charge (imports valides, JSX transpile, pas de référence non définie au niveau module).
const screens = [
  '../App',
  '../screens/AccueilScreen',
  '../screens/AuthScreen',
  '../screens/CompetitionScreen',
  '../screens/CreateCompetitionScreen',
  '../screens/CustomizationScreen',
  '../screens/FeedScreen',
  '../screens/FriendsScreen',
  '../screens/JoinCompetitionScreen',
  '../screens/RecapScreen',
  '../screens/ResetPasswordScreen',
  '../screens/ShareToCompetitionScreen',
  '../screens/ShopScreen',
];

test.each(screens)('%s se charge sans erreur de syntaxe', (path) => {
  expect(() => require(path)).not.toThrow(SyntaxError);
});
