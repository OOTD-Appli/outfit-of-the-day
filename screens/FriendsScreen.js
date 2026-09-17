import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/themeContext';
import { useToast } from '../lib/toastContext';
import Avatar from '../components/Avatar';

// Amis : concept indépendant des compétitions (sert le classement "Top 3
// amis" de RecapScreen). Repris de FlammesScreen.js (demande/acceptation),
// sans le chat/streak qui n'existent plus pour ce contexte — pas d'appel à
// ensureFlammesRow ici.
const normalizeStr = (s) => s
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^\x00-\x7F]/g, ' ')
  .replace(/[^a-z0-9_\s]/gi, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

export default function FriendsScreen({ navigation }) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingPendingIds, setOutgoingPendingIds] = useState([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setUserId(user.id);

    const [{ data: fd1 }, { data: fd2 }, { data: incRows }, { data: out }] = await Promise.all([
      supabase.from('friendships').select('friend_id').eq('user_id', user.id).eq('status', 'accepted'),
      supabase.from('friendships').select('user_id').eq('friend_id', user.id).eq('status', 'accepted'),
      supabase.from('friendships').select('user_id, created_at').eq('friend_id', user.id).eq('status', 'pending'),
      supabase.from('friendships').select('friend_id').eq('user_id', user.id).eq('status', 'pending'),
    ]);
    const friendIds = [...new Set([...(fd1 || []).map(r => r.friend_id), ...(fd2 || []).map(r => r.user_id)])];
    const requesterIds = [...new Set((incRows || []).map(r => r.user_id))];
    const allIds = [...new Set([...friendIds, ...requesterIds])];

    let profileById = {};
    if (allIds.length) {
      const { data: profs } = await supabase.from('profiles').select('id, username, avatar_url').in('id', allIds);
      profileById = Object.fromEntries((profs || []).map(p => [p.id, p]));
    }

    setFriends(friendIds.map(id => profileById[id]).filter(Boolean));
    setIncomingRequests((incRows || []).map(r => ({ user_id: r.user_id, profile: profileById[r.user_id] || { id: r.user_id, username: 'Utilisateur' } })));
    setOutgoingPendingIds((out || []).map(r => r.friend_id));
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const acceptRequest = async (requesterId) => {
    try {
      const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('user_id', requesterId).eq('friend_id', userId).eq('status', 'pending');
      if (error) throw error;
      await fetchData();
    } catch (e) { showToast(e?.message || 'Réessaie plus tard.', { type: 'error' }); }
  };

  const declineRequest = async (requesterId) => {
    try {
      const { error } = await supabase.from('friendships').delete().eq('user_id', requesterId).eq('friend_id', userId).eq('status', 'pending');
      if (error) throw error;
      await fetchData();
    } catch (e) { showToast(e?.message || 'Réessaie plus tard.', { type: 'error' }); }
  };

  const cancelOutgoing = (targetId) => {
    Alert.alert('Annuler la demande ?', "L'autre utilisateur ne verra plus ta demande.", [
      { text: 'Non', style: 'cancel' },
      {
        text: 'Annuler', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('friendships').delete().eq('user_id', userId).eq('friend_id', targetId).eq('status', 'pending');
          if (!error) await fetchData();
        },
      },
    ]);
  };

  const sendFriendRequest = async (friendId) => {
    if (!userId || friendId === userId) return;
    if (friends.some(f => f.id === friendId)) return;
    const theyRequested = incomingRequests.find(r => r.user_id === friendId);
    if (theyRequested) { await acceptRequest(friendId); return; }
    if (outgoingPendingIds.includes(friendId)) return;
    try {
      const { error } = await supabase.from('friendships').insert({ user_id: userId, friend_id: friendId, status: 'pending' });
      if (error) { if (error.code === '23505') { await fetchData(); return; } throw error; }
      showToast('Demande envoyée', { type: 'success' });
      await fetchData();
    } catch (e) { showToast(e?.message || 'Envoi impossible', { type: 'error' }); }
  };

  const searchUsers = async (q) => {
    setQuery(q);
    const clean = q.trim();
    if (clean.length < 2) { setSearchResults([]); return; }
    const normalized = normalizeStr(clean);
    const patterns = [...new Set([clean.toLowerCase(), normalized])].filter(p => p.length >= 2);
    const all = await Promise.all(
      patterns.map(p => supabase.from('profiles').select('id, username, avatar_url').ilike('username', `%${p}%`).neq('id', userId).limit(10)),
    );
    const seen = new Set();
    const merged = [];
    for (const { data } of all) for (const item of (data || [])) if (!seen.has(item.id)) { seen.add(item.id); merged.push(item); }
    setSearchResults(merged.slice(0, 12));
  };

  const relationFor = (id) => {
    if (friends.some(f => f.id === id)) return 'friend';
    if (incomingRequests.some(r => r.user_id === id)) return 'incoming';
    if (outgoingPendingIds.includes(id)) return 'outgoing';
    return 'none';
  };

  const renderAction = (item) => {
    const rel = relationFor(item.id);
    if (rel === 'friend') return <Text style={{ color: theme.textSub, fontSize: 12.5 }}>Amis ✓</Text>;
    if (rel === 'incoming') return (
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <TouchableOpacity style={[styles.smallBtn, { backgroundColor: theme.accent }]} onPress={() => acceptRequest(item.id)}>
          <Text style={styles.smallBtnText}>Accepter</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.smallBtnGhost} onPress={() => declineRequest(item.id)}>
          <Ionicons name="close" size={18} color="#ff6b6b" />
        </TouchableOpacity>
      </View>
    );
    if (rel === 'outgoing') return (
      <TouchableOpacity style={[styles.smallBtnOutline, { borderColor: theme.accent }]} onPress={() => cancelOutgoing(item.id)}>
        <Text style={[styles.smallBtnOutlineText, { color: theme.accent }]}>Demandée</Text>
      </TouchableOpacity>
    );
    return (
      <TouchableOpacity style={[styles.smallBtn, { backgroundColor: theme.accent }]} onPress={() => sendFriendRequest(item.id)}>
        <Text style={styles.smallBtnText}>Ajouter</Text>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={theme.textPri} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPri }]}>Mes amis</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.body}>
        <TextInput
          style={[styles.searchInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
          placeholder="Rechercher un pseudo..."
          placeholderTextColor={theme.textSub}
          value={query}
          onChangeText={searchUsers}
          autoCapitalize="none"
        />

        <FlatList
          data={query.trim().length >= 2 ? searchResults : friends}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            query.trim().length < 2 && incomingRequests.length > 0 ? (
              <View style={{ marginBottom: 16 }}>
                <Text style={[styles.sectionLabel, { color: theme.textSub }]}>Demandes reçues</Text>
                {incomingRequests.map(r => (
                  <View key={r.user_id} style={[styles.row, { backgroundColor: theme.card, borderColor: theme.border }]}>
                    <Avatar uri={r.profile?.avatar_url} username={r.profile?.username} size={36} />
                    <Text style={[styles.username, { color: theme.textPri }]}>{r.profile?.username}</Text>
                    {renderAction({ id: r.user_id })}
                  </View>
                ))}
                <Text style={[styles.sectionLabel, { color: theme.textSub, marginTop: 12 }]}>Mes amis</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[styles.row, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Avatar uri={item.avatar_url} username={item.username} size={36} />
              <Text style={[styles.username, { color: theme.textPri }]}>{item.username}</Text>
              {renderAction(item)}
            </View>
          )}
          ListEmptyComponent={
            <Text style={{ color: theme.textSub, textAlign: 'center', marginTop: 24, fontSize: 13.5 }}>
              {query.trim().length >= 2 ? 'Aucun résultat' : "Tu n'as pas encore d'amis. Cherche un pseudo pour en ajouter."}
            </Text>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 16, fontWeight: '800' },
  body: { flex: 1, padding: 16 },
  searchInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 14 },
  sectionLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, padding: 10, marginBottom: 8 },
  username: { flex: 1, fontWeight: '600', fontSize: 14.5 },
  smallBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  smallBtnGhost: { paddingHorizontal: 6, justifyContent: 'center' },
  smallBtnOutline: { borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 7 },
  smallBtnOutlineText: { fontWeight: '700', fontSize: 12.5 },
});
