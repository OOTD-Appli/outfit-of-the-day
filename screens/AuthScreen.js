import { Image } from 'react-native';
import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { ensureUserProfile } from '../lib/ensureProfile';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';

export default function AuthScreen() {
  const { height: wh } = useWindowDimensions();
  const logoSize = Math.min(Math.round(wh * 0.17), 140);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const { theme } = useTheme();

  const handleAuth = async () => {
    if (!email || !password) {
      showToast('Remplis tous les champs !', { type: 'warning' });
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          showToast(error.message, { type: 'error' });
        } else {
          const r = await ensureUserProfile();
          if (!r.ok) {
            showToast('Session OK mais profil : ' + (r.error?.message || 'erreur inconnue'), { type: 'warning' });
          }
        }
      } else {
        if (!username) {
          showToast('Choisis un pseudo !', { type: 'warning' });
          setLoading(false);
          return;
        }
        const cleanUser = username.trim();
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: cleanUser } },
        });
        if (error) {
          showToast(error.message, { type: 'error' });
          setLoading(false);
          return;
        }

        if (data.session && data.user) {
          const { error: pe } = await supabase.from('profiles').upsert(
            { id: data.user.id, username: cleanUser },
            { onConflict: 'id' },
          );
          if (pe) {
            showToast('Profil : ' + pe.message, { type: 'warning' });
          }
        } else if (data.user) {
          showToast(
            'Vérifie ta boîte mail : confirme ton compte, puis reconnecte-toi. ' +
            'Ton profil sera créé automatiquement au premier login.',
            { type: 'info' }
          );
        }
      }
    } catch (e) {
      showToast('Erreur : ' + e.message, { type: 'error' });
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>

        <Image source={require('../assets/logo.jpg')} style={[styles.logoImg, { width: logoSize, height: logoSize }]} />
        <Text style={[styles.subtitle, { color: theme.textSub }]}>
          {isLogin ? 'Connecte-toi' : 'Crée ton compte'}
        </Text>

        {!isLogin && (
          <TextInput
            style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
            placeholder="Pseudo"
            placeholderTextColor={theme.textSub}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
        )}

        <TextInput
          style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
          placeholder="Email"
          placeholderTextColor={theme.textSub}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <TextInput
          style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
          placeholder="Mot de passe"
          placeholderTextColor={theme.textSub}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={[styles.btn, { backgroundColor: theme.accent }]} onPress={handleAuth} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#3a0d1e" />
            : <Text style={styles.btnText}>{isLogin ? 'Se connecter' : "S'inscrire"}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setIsLogin(!isLogin)} style={styles.switchBtn}>
          <Text style={[styles.switchText, { color: theme.textSub }]}>
            {isLogin ? "Pas encore de compte ? S'inscrire" : 'Déjà un compte ? Se connecter'}
          </Text>
        </TouchableOpacity>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  logoImg:   { alignSelf: 'center', marginBottom: 8, borderRadius: 24 },
  container: { flex: 1 },
  inner:     { flex: 1, padding: 30, justifyContent: 'center' },
  subtitle:  { fontSize: 16, textAlign: 'center', marginBottom: 40 },

  input: {
    borderRadius: 12,
    padding: 16,
    fontSize: 15,
    marginBottom: 14,
    borderWidth: 1,
  },

  btn:     { borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#3a0d1e', fontWeight: '700', fontSize: 16 },

  switchBtn:  { marginTop: 20, alignItems: 'center' },
  switchText: { fontSize: 13 },

  logoSmall: { width: 40, height: 40, borderRadius: 8 },
});
