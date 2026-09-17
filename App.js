import { registerForPushNotifications, savePushToken, scheduleFlammeReminder } from './lib/notifications';
import { registerWebPush } from './lib/webPush';
import { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Platform } from 'react-native';
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
import ProfilScreen from './screens/ProfilScreen';
import ShopScreen from './screens/ShopScreen';
import CreateCompetitionScreen from './screens/CreateCompetitionScreen';
import CompetitionScreen from './screens/CompetitionScreen';

const Tab = createBottomTabNavigator();
const AccueilStackNav = createNativeStackNavigator();
const RecapStackNav = createNativeStackNavigator();

function AccueilStack() {
  return (
    <AccueilStackNav.Navigator screenOptions={{ headerShown: false }}>
      <AccueilStackNav.Screen name="AccueilHome" component={AccueilScreen} />
      <AccueilStackNav.Screen name="CreateCompetition" component={CreateCompetitionScreen} />
      <AccueilStackNav.Screen name="Competition" component={CompetitionScreen} />
      {/* ShareToCompetitionScreen rejoint cette stack juste après. */}
    </AccueilStackNav.Navigator>
  );
}

// Temporaire (pré-Phase 3) : contenu de l'ancien ProfilScreen, juste remonté
// sous l'onglet Récap. RecapScreen (stats + réglages + abonnement +
// classements) remplacera "RecapHome" en Phase 3.
function RecapStack() {
  return (
    <RecapStackNav.Navigator screenOptions={{ headerShown: false }}>
      <RecapStackNav.Screen name="RecapHome" component={ProfilScreen} />
      <RecapStackNav.Screen name="Shop" component={ShopScreen} />
    </RecapStackNav.Navigator>
  );
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
            tabBarIcon: ({ color, focused }) => (
              <TabIconPill name="sparkles-outline" focused={focused} color={color} accent={theme.accent} />
            ),
          }}
        />
        <Tab.Screen
          name="Feed"
          component={FeedScreen}
          options={{
            headerShown: false,
            tabBarIcon: ({ color, focused }) => (
              <TabIconPill name="home-outline" focused={focused} color={color} accent={theme.accent} />
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

      try {
        if (Platform.OS === 'web') {
          await registerWebPush();
          return;
        }
        await scheduleFlammeReminder(); // rappel local quotidien « prends ta photo » (natif)
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

  // Deep link Compétitions (?join_competition=<token>) : arrive en Phase 4 de
  // la refonte, sur le même modèle que l'ancien ?chat=<id> (retiré ici avec le
  // chat 1-à-1 — plus de route 'Chat' à cibler).

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
