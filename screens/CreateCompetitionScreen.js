import { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Share, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/themeContext';
import { useToast } from '../lib/toastContext';

// Crée une compétition puis affiche tout de suite un lien d'invitation à
// partager (n'importe quel membre peut en générer/révoquer un — cf.
// create_competition_invite). Pas de sélecteur de membres ici : on invite
// uniquement par lien, cohérent avec l'absence de mécanisme d'invitation
// préexistant dans l'app.
export default function CreateCompetitionScreen({ navigation }) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(null); // { competition_id, name }
  const [invite, setInvite] = useState(null); // { token }
  const [invitePending, setInvitePending] = useState(false);

  const createCompetition = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc('create_competition', { p_name: trimmed });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Erreur inconnue');
      setCreated({ competition_id: data.competition_id, name: data.name });
    } catch (e) {
      showToast(e?.message || 'Erreur inconnue', { type: 'error' });
    }
    setCreating(false);
  };

  const generateInvite = async () => {
    if (!created || invitePending) return;
    setInvitePending(true);
    try {
      const { data, error } = await supabase.rpc('create_competition_invite', {
        p_competition_id: created.competition_id,
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Erreur inconnue');
      setInvite({ token: data.token });
    } catch (e) {
      showToast(e?.message || 'Erreur inconnue', { type: 'error' });
    }
    setInvitePending(false);
  };

  const shareInvite = async () => {
    if (!invite) return;
    const base = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://ootd-fr.vercel.app';
    const url = `${base}/?join_competition=${invite.token}`;
    try {
      await Share.share({ message: `Rejoins "${created.name}" sur OOTD : ${url}` });
    } catch (_) {}
  };

  const goToCompetition = () => {
    navigation.replace('Competition', { competitionId: created.competition_id, competitionName: created.name });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={theme.textPri} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPri }]}>Créer une compétition</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        {!created ? (
          <>
            <Text style={[styles.label, { color: theme.textSub }]}>Nom de la compétition</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
              placeholder="Ma famille, Les 2 amis..."
              placeholderTextColor={theme.textSub}
              value={name}
              onChangeText={setName}
              maxLength={60}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.btnPrimary, { backgroundColor: theme.accent }, (!name.trim() || creating) && styles.disabled]}
              onPress={createCompetition}
              disabled={!name.trim() || creating}
            >
              {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Créer</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.successTitle, { color: theme.textPri }]}>"{created.name}" créée 🎉</Text>
            <Text style={[styles.successSub, { color: theme.textSub }]}>
              Invite tes proches en partageant un lien — ils rejoignent la compétition en un clic.
            </Text>

            {!invite ? (
              <TouchableOpacity
                style={[styles.btnSecondary, { borderColor: theme.accent }, invitePending && styles.disabled]}
                onPress={generateInvite}
                disabled={invitePending}
              >
                {invitePending
                  ? <ActivityIndicator color={theme.accent} />
                  : <Text style={[styles.btnSecondaryText, { color: theme.accent }]}>🔗 Générer un lien d'invitation</Text>}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.btnSecondary, { borderColor: theme.accent }]} onPress={shareInvite}>
                <Text style={[styles.btnSecondaryText, { color: theme.accent }]}>📤 Partager le lien</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={[styles.btnPrimary, { backgroundColor: theme.accent, marginTop: 24 }]} onPress={goToCompetition}>
              <Text style={styles.btnPrimaryText}>Aller à la compétition</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 16, fontWeight: '800' },
  body: { padding: 20 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 18 },
  btnPrimary: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnSecondary: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5 },
  btnSecondaryText: { fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.55 },
  successTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  successSub: { fontSize: 13.5, marginBottom: 24, lineHeight: 19 },
});
