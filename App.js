import { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { supabase } from './lib/supabase';

import AuthScreen from './screens/AuthScreen';
import AccueilScreen from './screens/AccueilScreen';
import FeedScreen from './screens/FeedScreen';
import FlammesScreen from './screens/FlammesScreen';
import ProfilScreen from './screens/ProfilScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
  }, []);

  if (loading) return null;
  if (!session) return <AuthScreen />;

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#0f0f0f',
            borderTopColor: '#1a1a1a',
            paddingBottom: 20,
            height: 80,
          },
          tabBarActiveTintColor: '#ED93B1',
          tabBarInactiveTintColor: '#444',
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tab.Screen
          name="Accueil"
          component={AccueilScreen}
          options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👗</Text> }}
        />
        <Tab.Screen
          name="Feed"
          component={FeedScreen}
          options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🏠</Text> }}
        />
        <Tab.Screen
          name="Flammes"
          component={FlammesScreen}
          options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🔥</Text> }}
        />
        <Tab.Screen
          name="Profil"
          component={ProfilScreen}
          options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👤</Text> }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}