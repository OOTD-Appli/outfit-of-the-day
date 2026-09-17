import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/themeContext';
import { useToast } from '../lib/toastContext';

// Atteint via le lien d'invitation (?join_competition=<token>), après que
// l'utilisateur est authentifié (voir App.js). Toujours un écran de
// confirmation avant d'adhérer réellement — jamais silencieux au clic, un
// lien peut être périmé/révoqué/transféré (décidé explicitement).
export default function JoinCompetitionScreen({ route, navigation }) {
  const { token } = route.params || {};
  const { theme } = useTheme();
  const { showToast } = useToast();
  const [state, setState] = useState('loading'); // loading | preview | joining | error
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) { setError('Lien invalide'); setState('error'); return; }
    (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('get_competition_invite_preview', { p_token: token });
        if (rpcError) throw new Error(rpcError.message);
        if (!data?.ok) { setError(data?.error || 'Lien invalide'); setState('error'); return; }
        setPreview(data);
        setState('preview');
      } catch (e) {
        setError(e?.message || 'Erreur inconnue');
        setState('error');
      }
    })();
  }, [token]);

  const join = async () => {
    setState('joining');
    try {
      const { data, error: rpcError } = await supabase.rpc('redeem_competition_invite', { p_token: token });
      if (rpcError) throw new Error(rpcError.message);
      if (!data?.ok) throw new Error(data?.error || 'Erreur inconnue');
      if (!data.already_member) showToast(`Tu as rejoint "${data.competition_name}" 🎉`, { type: 'success' });
      navigation.replace('Competition', { competitionId: data.competition_id, competitionName: data.competition_name });
    } catch (e) {
      setError(e?.message || 'Erreur inconnue');
      setState('error');
    }
  };

  if (state === 'loading' || state === 'joining') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.accent} size="large" />
      </SafeAreaView>
    );
  }

  if (state === 'error') {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
        <Ionicons name="alert-circle-outline" size={40} color={theme.textSub} />
        <Text style={[styles.errorText, { color: theme.textPri }]}>{error}</Text>
        <TouchableOpacity style={[styles.btn, { backgroundColor: theme.accent, marginTop: 20 }]} onPress={() => navigation.navigate('AccueilHome')}>
          <Text style={styles.btnText}>Retourner à l'accueil</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Ionicons name="trophy" size={36} color={theme.accent} />
        <Text style={[styles.title, { color: theme.textPri }]}>{preview.competition_name}</Text>
        <Text style={[styles.sub, { color: theme.textSub }]}>
          {preview.member_count} membre{preview.member_count > 1 ? 's' : ''}
        </Text>
        <TouchableOpacity style={[styles.btn, { backgroundColor: theme.accent, marginTop: 24 }]} onPress={join}>
          <Text style={styles.btnText}>Rejoindre</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ marginTop: 14 }} onPress={() => navigation.navigate('AccueilHome')}>
          <Text style={{ color: theme.textSub, fontSize: 13.5 }}>Pas maintenant</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: { width: '100%', maxWidth: 340, alignItems: 'center', borderRadius: 20, borderWidth: 1, padding: 28 },
  title: { fontWeight: '800', fontSize: 19, marginTop: 12, textAlign: 'center' },
  sub: { fontSize: 13.5, marginTop: 4 },
  errorText: { fontSize: 14.5, textAlign: 'center', marginTop: 12 },
  btn: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
