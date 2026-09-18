import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/themeContext';
import { useToast } from '../lib/toastContext';
import Avatar from '../components/Avatar';

// Créer une compétition : nom + sélection des membres parmi les amis déjà
// ajoutés (Récap > Mes amis). Remplace l'ancien flow "créer puis générer un
// lien" — la composition peut être modifiée plus tard (lien d'invitation
// toujours disponible depuis l'écran de la compétition pour ajouter du monde
// après coup).
export default function CreateCompetitionScreen({ navigation }) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [creating, setCreating] = useState(false);

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ data: fd1, error: e1 }, { data: fd2, error: e2 }] = await Promise.all([
        supabase.from('friendships').select('friend_id').eq('user_id', user.id).eq('status', 'accepted'),
        supabase.from('friendships').select('user_id').eq('friend_id', user.id).eq('status', 'accepted'),
      ]);
      if (e1 || e2) throw new Error((e1 || e2).message);
      const friendIds = [...new Set([...(fd1 || []).map(r => r.friend_id), ...(fd2 || []).map(r => r.user_id)])];
      if (!friendIds.length) { setFriends([]); return; }
      const { data: profs, error: e3 } = await supabase
        .from('profiles').select('id, username, avatar_url').in('id', friendIds);
      if (e3) throw new Error(e3.message);
      setFriends(profs || []);
    } catch (e) {
      showToast(e?.message || 'Erreur chargement des amis', { type: 'error' });
    }
    setFriendsLoading(false);
  }, [showToast]);

  useEffect(() => { loadFriends(); }, [loadFriends]);

  const toggleFriend = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const createCompetition = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc('create_competition_with_members', {
        p_name: trimmed,
        p_member_ids: Array.from(selected),
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Erreur inconnue');
      showToast(`"${data.name}" créée 🎉`, { type: 'success' });
      navigation.replace('Competition', { competitionId: data.competition_id, competitionName: data.name });
    } catch (e) {
      showToast(e?.message || 'Erreur inconnue', { type: 'error' });
    }
    setCreating(false);
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

      <FlatList
        data={friends}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.listHeader}>
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

            <Text style={[styles.label, { color: theme.textSub, marginTop: 8 }]}>
              Qui participe ? ({selected.size} sélectionné{selected.size > 1 ? 's' : ''})
            </Text>
            {friendsLoading && <ActivityIndicator color={theme.accent} style={{ marginVertical: 12 }} />}
            {!friendsLoading && friends.length === 0 && (
              <View style={[styles.emptyFriendsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                <Text style={{ color: theme.textSub, fontSize: 13, lineHeight: 19 }}>
                  Tu n'as pas encore d'amis ajoutés. Va dans Récap → Mes amis pour en chercher et en ajouter, puis reviens ici pour créer ta compétition.
                </Text>
                <TouchableOpacity
                  style={{ marginTop: 10 }}
                  onPress={() => navigation.navigate('Récap', { screen: 'Friends' })}
                >
                  <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>Aller à Mes amis →</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const isSelected = selected.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.friendRow, { borderColor: theme.border, backgroundColor: theme.card }]}
              onPress={() => toggleFriend(item.id)}
              activeOpacity={0.85}
            >
              <Avatar uri={item.avatar_url} username={item.username} size={36} />
              <Text style={[styles.friendName, { color: theme.textPri }]}>{item.username}</Text>
              <View style={[styles.checkbox, { borderColor: theme.accent }, isSelected && { backgroundColor: theme.accent }]}>
                {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <View style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.bg }]}>
        <TouchableOpacity
          style={[styles.btnPrimary, { backgroundColor: theme.accent }, (!name.trim() || creating) && styles.disabled]}
          onPress={createCompetition}
          disabled={!name.trim() || creating}
        >
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Créer</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 16, fontWeight: '800' },
  list: { padding: 20, paddingBottom: 100 },
  listHeader: { marginBottom: 4 },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 18 },
  emptyFriendsCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8 },
  friendRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 8 },
  friendName: { flex: 1, fontWeight: '600', fontSize: 14.5 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  btnPrimary: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.55 },
});
