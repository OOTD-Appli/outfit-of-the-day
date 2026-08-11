import { Image } from 'expo-image';
import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';

// Écran d'atterrissage du lien de réinitialisation (/reset-password).
// Rendu uniquement quand une session de récupération est active (event
// PASSWORD_RECOVERY détecté dans App.js). onDone() est appelé après succès.
export default function ResetPasswordScreen({ onDone }) {
  const { height: wh } = useWindowDimensions();
  const logoSize = Math.min(Math.round(wh * 0.15), 120);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const { theme } = useTheme();

  const handleUpdate = async () => {
    if (!password || !confirm) {
      showToast('Remplis les deux champs.', { type: 'warning' });
      return;
    }
    if (password.length < 6) {
      showToast('Le mot de passe doit faire au moins 6 caractères.', { type: 'warning' });
      return;
    }
    if (password !== confirm) {
      showToast('Les mots de passe ne correspondent pas.', { type: 'warning' });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        showToast(error.message, { type: 'error' });
        setLoading(false);
        return;
      }
      // Déconnecte la session de récupération → retour propre à l'écran de connexion
      await supabase.auth.signOut();
      showToast('Mot de passe mis à jour ! Connecte-toi avec le nouveau.', { type: 'success' });
      onDone?.();
    } catch (e) {
      showToast('Erreur : ' + (e?.message || 'inconnue'), { type: 'error' });
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>

        <Image source={require('../assets/logo.jpg')} style={[styles.logoImg, { width: logoSize, height: logoSize }]} />
        <Text style={[styles.title, { color: theme.textPri }]}>Nouveau mot de passe</Text>
        <Text style={[styles.subtitle, { color: theme.textSub }]}>
          Choisis un nouveau mot de passe pour ton compte.
        </Text>

        <TextInput
          style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
          placeholder="Nouveau mot de passe"
          placeholderTextColor={theme.textSub}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />
        <TextInput
          style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
          placeholder="Confirmer le mot de passe"
          placeholderTextColor={theme.textSub}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
        />

        <TouchableOpacity style={[styles.btn, { backgroundColor: theme.accent }]} onPress={handleUpdate} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#3a0d1e" />
            : <Text style={styles.btnText}>Mettre à jour</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => onDone?.()} style={styles.switchBtn}>
          <Text style={[styles.switchText, { color: theme.textSub }]}>Retour à la connexion</Text>
        </TouchableOpacity>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  logoImg:   { alignSelf: 'center', marginBottom: 12, borderRadius: 24 },
  container: { flex: 1 },
  inner:     { flex: 1, padding: 30, justifyContent: 'center' },
  title:     { fontSize: 22, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  subtitle:  { fontSize: 14, textAlign: 'center', marginBottom: 32, paddingHorizontal: 10, lineHeight: 20 },
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
});
