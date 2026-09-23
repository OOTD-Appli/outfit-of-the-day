import { registerForPushNotifications, savePushToken, scheduleDailyReminder } from './lib/notifications';
import { registerWebPush } from './lib/webPush';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Platform, PanResponder } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { supabase } from './lib/supabase';
import { ensureUserProfile } from './lib/ensureProfile';
import { ToastProvider } from './lib/toastContext';
import { ThemeProvider, useTheme } from './lib/themeContext';
import AppHeader from './components/AppHeader';

const navigationRef = createNavigationContainerRef();

// URL capturée au chargement du module (avant que supabase-js ne nettoie le hash).
const INITIAL_HREF = (typeof window !== 'undefined' && window.location) ? window.location.href : '';
// Détecte un atterrissage de réinitialisation : token recovery dans le hash/query
// OU chemin /reset-password (qui survit au nettoyage du hash par supabase-js).
function isRecoveryHref(href) {
  return /[#?&]type=recovery/i.test(href) || /\/reset-password/i.test(href);
}

// Deep link Compétitions : extrait le token de ?join_competition=<token>.
// Même modèle que l'ancien ?chat=<id> — voir PENDING_JOIN_TOKEN_KEY plus bas
// pour la partie "capturé avant que l'utilisateur ait un compte".
function joinCompetitionTokenFromUrl(href) {
  try { return new URL(href).searchParams.get('join_competition'); } catch (_) { return null; }
}

const PENDING_JOIN_TOKEN_KEY = '@ootd_pending_join_token';

// Extrait les paramètres d'auth présents dans le hash ET la query string.
// iOS Safari/PWA tronque parfois le hash ou ne déclenche pas detectSessionInUrl :
// on parse nous-mêmes et on établira la session explicitement.
function parseAuthParams(href) {
  const out = { access_token: null, refresh_token: null, type: null, token_hash: null, code: null };
  try {
    const u = new URL(href);
    const hash = u.hash && u.hash.startsWith('#') ? u.hash.slice(1) : (u.hash || '');
    const fromHash = new URLSearchParams(hash);
    const fromQuery = u.searchParams;
    for (const k of Object.keys(out)) {
      out[k] = fromHash.get(k) || fromQuery.get(k) || null;
    }
  } catch (_) {}
  return out;
}

import AuthScreen from './screens/AuthScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import AccueilScreen from './screens/AccueilScreen';
import FeedScreen from './screens/FeedScreen';
import RecapScreen from './screens/RecapScreen';
import ShopScreen from './screens/ShopScreen';
import FriendsScreen from './screens/FriendsScreen';
import CompetitionsListScreen from './screens/CompetitionsListScreen';
import CreateCompetitionScreen from './screens/CreateCompetitionScreen';
import CompetitionScreen from './screens/CompetitionScreen';
import ShareToCompetitionScreen from './screens/ShareToCompetitionScreen';
import JoinCompetitionScreen from './screens/JoinCompetitionScreen';
import PalmaresScreen from './screens/PalmaresScreen';

const Tab = createBottomTabNavigator();
const AccueilStackNav = createNativeStackNavigator();
const CompetitionsStackNav = createNativeStackNavigator();
const DecouvrirStackNav = createNativeStackNavigator();
const RecapStackNav = createNativeStackNavigator();

// Onglet "✨ Analyse" (ex-Accueil) : capture + analyse IA (inchangé) — le nom
// de route reste "Accueil" pour ne pas casser les navigate('Accueil', ...)
// existants (deep link, rappel de notification, JoinCompetitionScreen).
// "Competition" reste aussi présent ici (en plus de CompetitionsStack) car
// ShareToCompetitionScreen fait navigation.replace('Competition', ...) — un
// replace() cible toujours un écran du MÊME stack, jamais un autre onglet.
function AccueilStack() {
  return (
    <AccueilStackNav.Navigator screenOptions={{ headerShown: false }}>
      <AccueilStackNav.Screen name="AccueilHome" component={AccueilScreen} />
      <AccueilStackNav.Screen name="ShareToCompetition" component={ShareToCompetitionScreen} />
      <AccueilStackNav.Screen name="Competition" component={CompetitionScreen} />
    </AccueilStackNav.Navigator>
  );
}

// Onglet "🏆 Compétitions" (nouveau, décision D2) : liste des ligues, création,
// détail (classement/galerie/chat), rejoindre via lien d'invitation.
function CompetitionsStack() {
  return (
    <CompetitionsStackNav.Navigator screenOptions={{ headerShown: false }}>
      <CompetitionsStackNav.Screen name="CompetitionsHome" component={CompetitionsListScreen} />
      <CompetitionsStackNav.Screen name="CreateCompetition" component={CreateCompetitionScreen} />
      <CompetitionsStackNav.Screen name="Competition" component={CompetitionScreen} />
      <CompetitionsStackNav.Screen name="JoinCompetition" component={JoinCompetitionScreen} />
    </CompetitionsStackNav.Navigator>
  );
}

// Onglet "🧭 Découvrir" (ex-Feed) : contenu Feed inchangé + Palmarès (décision
// D3). Le nom de route reste "Feed" pour ne pas casser ShareToCompetitionScreen
// (navigation.navigate('Feed')) — seul le libellé affiché change (tabBarLabel).
function DecouvrirStack() {
  return (
    <DecouvrirStackNav.Navigator screenOptions={{ headerShown: false }}>
      <DecouvrirStackNav.Screen name="Feed" component={FeedScreen} />
      <DecouvrirStackNav.Screen name="Palmares" component={PalmaresScreen} />
    </DecouvrirStackNav.Navigator>
  );
}

function RecapStack() {
  return (
    <RecapStackNav.Navigator screenOptions={{ headerShown: false }}>
      <RecapStackNav.Screen name="RecapHome" component={RecapScreen} />
      <RecapStackNav.Screen name="Shop" component={ShopScreen} />
      <RecapStackNav.Screen name="Friends" component={FriendsScreen} />
    </RecapStackNav.Navigator>
  );
}

// ===========================================================================
// Swipe latéral entre onglets (2026-09-29) — ordre visuel Analyse/Compétitions/
// Découvrir/Récap. Ne se déclenche QUE quand l'onglet actif est à la racine de
// sa propre pile interne (aucun écran empilé par-dessus) : dès qu'un écran est
// poussé (CompetitionScreen et son pager interne Photos&chat/Classement + son
// viewer plein écran + le swipe-to-reply des messages, ShopScreen, FriendsScreen,
// CreateCompetitionScreen, PalmaresScreen, JoinCompetitionScreen...), ce swipe
// se désactive de lui-même et laisse la priorité totale aux gestes internes de
// cet écran. C'est le même principe que la plupart des apps à onglets + pile de
// navigation (le swipe entre sections ne fonctionne que sur l'écran d'accueil
// de chaque section) — et ça évite d'avoir à arbitrer geste par geste contre
// les PanResponder internes de ces écrans, puisqu'ils ne sont jamais la racine
// d'un onglet. Seuil de distance + dominance horizontale volontairement plus
// élevés que les gestes internes de l'app (60px, ratio 1.4) pour limiter le
// risque de faux positif contre un petit carrousel horizontal interne à un
// écran racine.
const TAB_ORDER = ['Accueil', 'Compétitions', 'Feed', 'Récap'];
const TAB_SWIPE_THRESHOLD = 60;
const TAB_SWIPE_DOMINANCE = 1.4;

function getActiveTabRootInfo() {
  if (!navigationRef.isReady()) return null;
  const state = navigationRef.getRootState();
  if (!state?.routes?.length) return null;
  const activeRoute = state.routes[state.index];
  // Une pile interne fraîchement montée peut ne pas encore avoir de `.state`
  // du tout (undefined) — c'est aussi "à la racine" (aucun écran poussé).
  const isAtRoot = !activeRoute.state || activeRoute.state.index === 0;
  return { activeIndex: state.index, isAtRoot };
}

function useTabSwipeResponder() {
  return useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: (_, g) => {
        if (Math.abs(g.dx) < TAB_SWIPE_THRESHOLD || Math.abs(g.dx) < Math.abs(g.dy) * TAB_SWIPE_DOMINANCE) return false;
        return !!getActiveTabRootInfo()?.isAtRoot;
      },
      onPanResponderRelease: (_, g) => {
        const info = getActiveTabRootInfo();
        if (!info?.isAtRoot) return;
        const nextIndex = info.activeIndex + (g.dx < 0 ? 1 : -1);
        if (nextIndex < 0 || nextIndex >= TAB_ORDER.length) return;
        navigationRef.navigate(TAB_ORDER[nextIndex]);
      },
    })
  ).current;
}

function TabIconPill({ name, focused, color, accent }) {
  if (focused) {
    return (
      <View style={[styles.iconPill, { backgroundColor: accent }]}>
        <Ionicons name={name} size={22} color="#fff" />
      </View>
    );
  }
  return <Ionicons name={name} size={22} color={color} />;
}

function ThemedNavigator({ userId }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const tabSwipeResponder = useTabSwipeResponder();

  // Glassmorphism sur web : fond semi-transparent + blur
  const isWeb = Platform.OS === 'web';
  const tabBarStyle = {
    backgroundColor: isWeb ? (theme.tabBar + 'E8') : theme.tabBar,
    borderTopWidth: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: insets.bottom + 10,
    paddingTop: 10,
    height: 72 + insets.bottom,
    shadowColor: '#1A1412',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 16,
    ...(isWeb ? { backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' } : {}),
  };

  return (
    <NavigationContainer ref={navigationRef}>
      <View style={{ flex: 1 }} {...tabSwipeResponder.panHandlers}>
      <Tab.Navigator
        screenOptions={{
          // Le header est activé par défaut — FeedScreen (full-screen) le désactive
          headerShown: true,
          header: () => <AppHeader />,
          animation: 'shift',
          tabBarStyle,
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: '#C4B5AD',
          tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginTop: 2 },
        }}
      >
        <Tab.Screen
          name="Accueil"
          component={AccueilStack}
          options={{
            headerShown: false,
            tabBarLabel: 'Analyse',
            tabBarIcon: ({ color, focused }) => (
              <TabIconPill name="sparkles-outline" focused={focused} color={color} accent={theme.accent} />
            ),
          }}
        />
        <Tab.Screen
          name="Compétitions"
          component={CompetitionsStack}
          options={{
            headerShown: false,
            tabBarIcon: ({ color, focused }) => (
              <TabIconPill name="trophy-outline" focused={focused} color={color} accent={theme.accent} />
            ),
          }}
        />
        <Tab.Screen
          name="Feed"
          component={DecouvrirStack}
          options={{
            headerShown: false,
            tabBarLabel: 'Découvrir',
            tabBarIcon: ({ color, focused }) => (
              <TabIconPill name="compass-outline" focused={focused} color={color} accent={theme.accent} />
            ),
          }}
        />
        <Tab.Screen
          name="Récap"
          component={RecapStack}
          options={{
            headerShown: false,
            tabBarIcon: ({ color, focused }) => (
              <TabIconPill name="person-outline" focused={focused} color={color} accent={theme.accent} />
            ),
          }}
        />
      </Tab.Navigator>
      </View>
    </NavigationContainer>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // Initialisé dès le 1er rendu si l'URL est un lien de récupération → pas de
  // course avec l'évènement PASSWORD_RECOVERY (qui peut être précédé d'un SIGNED_IN).
  const [recovery, setRecovery] = useState(() => Platform.OS === 'web' && isRecoveryHref(INITIAL_HREF));

  useEffect(() => {
    let isMounted = true;

    // ── iOS PWA : établir explicitement la session de récupération ───────────
    // On ne dépend pas uniquement de detectSessionInUrl (peu fiable sur Safari/
    // iOS standalone). On lit les tokens capturés dans INITIAL_HREF et on pose
    // la session à la main → updateUser({password}) aura toujours une session.
    if (Platform.OS === 'web' && isRecoveryHref(INITIAL_HREF)) {
      setRecovery(true);
      (async () => {
        const p = parseAuthParams(INITIAL_HREF);
        try {
          if (p.access_token && p.refresh_token) {
            await supabase.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token });
          } else if (p.token_hash) {
            await supabase.auth.verifyOtp({ type: 'recovery', token_hash: p.token_hash });
          } else if (p.code) {
            await supabase.auth.exchangeCodeForSession(p.code);
          }
        } catch (e) {
          console.error('[recovery] établissement session échoué:', e?.message || e);
        } finally {
          if (isMounted) setLoading(false);
        }
      })();
    }

    const syncSession = async (nextSession) => {
      if (!isMounted) return;
      setSession(nextSession);
      setLoading(false);

      if (!nextSession) return;

      try {
        const prof = await ensureUserProfile();
        if (!prof.ok) console.warn('Profil:', prof.error?.message || prof.error);
      } catch (e) {
        console.warn('ensureUserProfile', e?.message || e);
      }

      // Lien d'invitation Compétitions cliqué avant que la session existe
      // (nouvel utilisateur pas encore inscrit) : le token a été capturé dans
      // AsyncStorage dès le chargement (voir plus bas), on le consomme ici dès
      // qu'une session existe, qu'elle vienne de getSession() ou d'un signup/
      // login qui vient juste de se produire.
      try {
        const pendingToken = await AsyncStorage.getItem(PENDING_JOIN_TOKEN_KEY);
        if (pendingToken) {
          await AsyncStorage.removeItem(PENDING_JOIN_TOKEN_KEY);
          setTimeout(() => {
            if (navigationRef.isReady()) {
              navigationRef.navigate('Compétitions', { screen: 'JoinCompetition', params: { token: pendingToken } });
            }
          }, 400);
        }
      } catch (_) {}

      try {
        if (Platform.OS === 'web') {
          await registerWebPush();
          return;
        }
        await scheduleDailyReminder(); // rappel local quotidien « prends ta photo » (natif)
        if (Constants.appOwnership === 'expo') return;
        const token = await registerForPushNotifications();
        if (token) await savePushToken(token);
      } catch (error) {
        console.log('Push setup error:', error?.message || error);
      }
    };

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (isMounted) syncSession(data.session);
      } catch (error) {
        console.warn('Failed to get initial session:', error);
        if (isMounted) { setLoading(false); setSession(null); }
      }
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Lien de réinitialisation cliqué (web) → on affiche l'écran dédié
      if (event === 'PASSWORD_RECOVERY') {
        setRecovery(true);
        setSession(nextSession);
        setLoading(false);
        return;
      }
      syncSession(nextSession);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Deep link Compétitions (?join_competition=<token>) : capturé dès le
  // chargement, même si aucune session n'existe encore (nouvel utilisateur
  // pas inscrit) — consommé dans syncSession dès qu'une session existe.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const token = joinCompetitionTokenFromUrl(INITIAL_HREF);
    if (!token) return;
    AsyncStorage.setItem(PENDING_JOIN_TOKEN_KEY, token).catch(() => {});
    if (typeof window !== 'undefined' && window.history) window.history.replaceState({}, '', '/');
  }, []);

  // Lien cliqué alors que l'app est déjà ouverte ET une session déjà active
  // (message du service worker) : syncSession ne se redéclenche pas dans ce
  // cas (pas de nouvel évènement d'auth), donc on route directement ici.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const handler = (event) => {
      if (event.data?.type !== 'deep-link') return;
      const token = joinCompetitionTokenFromUrl(event.data.url || '');
      if (token && navigationRef.isReady()) {
        navigationRef.navigate('Compétitions', { screen: 'JoinCompetition', params: { token } });
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);

  // Clic sur une notification native (Expo) → routage deep link
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const url = resp?.notification?.request?.content?.data?.url || '';
      if (!navigationRef.isReady()) return;
      if (/analyse/i.test(url)) {
        navigationRef.navigate('Accueil'); // rappel quotidien → écran de capture
      }
    });
    return () => sub.remove();
  }, []);

  if (loading) {
    return (
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#FAF7F5', alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color="#ED93B1" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <ToastProvider>
            {recovery ? (
              <ResetPasswordScreen onDone={() => {
                setRecovery(false);
                if (Platform.OS === 'web' && typeof window !== 'undefined' && window.history) {
                  window.history.replaceState({}, '', '/');
                }
              }} />
            ) : !session ? (
              <AuthScreen />
            ) : (
              <ThemedNavigator userId={session?.user?.id} />
            )}
          </ToastProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  iconPill: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
