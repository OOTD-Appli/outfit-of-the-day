import { registerForPushNotifications, savePushToken, scheduleFlammeReminder } from './lib/notifications';
import { registerWebPush } from './lib/webPush';
import { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from './lib/supabase';
import { ensureUserProfile } from './lib/ensureProfile';
import { ToastProvider } from './lib/toastContext';
import { ThemeProvider, useTheme } from './lib/themeContext';
import InAppBanner from './components/InAppBanner';

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
// Deep link messagerie : extrait l'id de conversation de ?chat=<id>
function chatIdFromUrl(href) {
  try { return new URL(href).searchParams.get('chat'); } catch (_) { return null; }
}

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
import FlammesScreen from './screens/FlammesScreen';
import ProfilScreen from './screens/ProfilScreen';
import ShopScreen from './screens/ShopScreen';

const Tab = createBottomTabNavigator();

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

function ChatTabIcon({ focused, color, accent, unreadCount }) {
  return (
    <View>
      {focused ? (
        <View style={[styles.iconPill, { backgroundColor: accent }]}>
          <Ionicons name="chatbubble-ellipses-outline" size={22} color="#fff" />
        </View>
      ) : (
        <Ionicons name="chatbubble-ellipses-outline" size={22} color={color} />
      )}
      {!focused && unreadCount > 0 && (
        <View style={styles.unreadDot}>
          <Text style={styles.unreadDotText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
        </View>
      )}
    </View>
  );
}

function ThemedNavigator({ userId }) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('app-unread-msgs')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `receiver_id=eq.${userId}`,
      }, () => setUnreadCount(prev => prev + 1))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [userId]);

  const tabBarStyle = {
    backgroundColor: theme.tabBar,
    borderTopWidth: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: insets.bottom + 10,
    paddingTop: 10,
    height: 72 + insets.bottom,
    shadowColor: '#1A1412',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.10,
    shadowRadius: 18,
    elevation: 14,
  };

  const openConversation = (friendId) => {
    setUnreadCount(0);
    if (navigationRef.isReady()) navigationRef.navigate('Chat', { openFriendId: friendId });
  };

  return (
    <>
    <NavigationContainer ref={navigationRef}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle,
          tabBarActiveTintColor: theme.accent,
          tabBarInactiveTintColor: '#C4B5AD',
          tabBarLabelStyle: { fontSize: 10, fontWeight: '600', marginTop: 2 },
        }}
      >
        <Tab.Screen
          name="Accueil"
          component={FeedScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIconPill name="home-outline" focused={focused} color={color} accent={theme.accent} />
            ),
          }}
        />
        <Tab.Screen
          name="Chat"
          component={FlammesScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <ChatTabIcon focused={focused} color={color} accent={theme.accent} unreadCount={unreadCount} />
            ),
          }}
          listeners={{ tabPress: () => setUnreadCount(0) }}
        />
        <Tab.Screen
          name="Analyse"
          component={AccueilScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIconPill name="sparkles-outline" focused={focused} color={color} accent={theme.accent} />
            ),
          }}
        />
        <Tab.Screen
          name="Profil"
          component={ProfilScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIconPill name="person-outline" focused={focused} color={color} accent={theme.accent} />
            ),
          }}
        />
        <Tab.Screen
          name="Shop"
          component={ShopScreen}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <TabIconPill name="bag-outline" focused={focused} color={color} accent={theme.accent} />
            ),
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
    <InAppBanner userId={userId} onPress={openConversation} />
    </>
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

  // Deep link messagerie depuis une notif cliquée APP FERMÉE (?chat=<id> dans l'URL)
  useEffect(() => {
    if (Platform.OS !== 'web' || !session || recovery) return;
    const id = chatIdFromUrl(INITIAL_HREF);
    if (!id) return;
    const t = setTimeout(() => {
      if (navigationRef.isReady()) navigationRef.navigate('Chat', { openFriendId: id });
      if (typeof window !== 'undefined' && window.history) window.history.replaceState({}, '', '/');
    }, 400);
    return () => clearTimeout(t);
  }, [session, recovery]);

  // Deep link depuis une notif cliquée APP DÉJÀ OUVERTE (message du service worker)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const handler = (event) => {
      if (event.data?.type !== 'deep-link') return;
      const id = chatIdFromUrl(event.data.url || '');
      if (id && navigationRef.isReady()) navigationRef.navigate('Chat', { openFriendId: id });
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
        navigationRef.navigate('Analyse'); // rappel flamme → écran d'analyse/caméra
      } else {
        const id = chatIdFromUrl(url);
        if (id) navigationRef.navigate('Chat', { openFriendId: id });
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
  unreadDot: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: '#ED93B1',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#FAF7F5',
  },
  unreadDotText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
