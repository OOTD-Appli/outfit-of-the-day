import { registerForPushNotifications, savePushToken } from './lib/notifications';
import { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { supabase } from './lib/supabase';
import { ensureUserProfile } from './lib/ensureProfile';
import { ToastProvider } from './lib/toastContext';
import { ThemeProvider, useTheme } from './lib/themeContext';

import AuthScreen from './screens/AuthScreen';
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

  return (
    <NavigationContainer>
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
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

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
        if (Platform.OS === 'web' || Constants.appOwnership === 'expo') return;
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

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      syncSession(nextSession);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
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
          {!session ? (
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
