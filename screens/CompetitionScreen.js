import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/themeContext';
import { useToast } from '../lib/toastContext';
import { setActiveCompetition } from '../lib/activeChat';
import Avatar from '../components/Avatar';

const GALLERY_PAGE = 24;

const RANKING_PERIODS = [
  { key: 'day', label: 'Jour' },
  { key: 'week', label: 'Semaine' },
  { key: 'month', label: 'Mois' },
  { key: 'all', label: 'Depuis toujours' },
];

// Classement (raison d'être de l'écran) + galerie (tenues soumises par les
// membres) + chat de groupe. V1 volontairement plus simple que l'ancien
// FlammesScreen 1-à-1 : pas d'audio, pas de swipe-to-reply, pas d'indicateur
// de frappe — ajoutables plus tard sans changer le modèle de données.
export default function CompetitionScreen({ route, navigation }) {
  const { competitionId, competitionName } = route.params || {};
  const { theme } = useTheme();
  const { showToast } = useToast();
  const [userId, setUserId] = useState(null);
  const [tab, setTab] = useState('ranking'); // 'ranking' | 'gallery' | 'chat'

  const [ranking, setRanking] = useState(null);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [period, setPeriod] = useState('week'); // 'day' | 'week' | 'month' | 'all'

  const [gallery, setGallery] = useState([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [sortByScore, setSortByScore] = useState(false);

  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const channelRef = useRef(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null));
  }, []);

  useEffect(() => {
    setActiveCompetition(competitionId);
    return () => setActiveCompetition(null);
  }, [competitionId]);

  const loadRanking = useCallback(async () => {
    setRankingLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_competition_leaderboard', { p_competition_id: competitionId, p_period: period });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erreur classement');
      setRanking(data);
    } catch (e) { showToast(e?.message || 'Erreur classement', { type: 'error' }); }
    setRankingLoading(false);
  }, [competitionId, period, showToast]);

  const loadGallery = useCallback(async () => {
    setGalleryLoading(true);
    try {
      let query = supabase
        .from('ootd_competitions')
        .select('ootd_id, created_at, ootds(id, image_url, score_global, caption, styles, user_id, profiles(username, avatar_url))')
        .eq('competition_id', competitionId);
      query = sortByScore
        ? query.order('score_global', { foreignTable: 'ootds', ascending: false })
        : query.order('created_at', { ascending: false });
      const { data, error } = await query.limit(GALLERY_PAGE);
      if (error) throw error;
      setGallery((data || []).filter(r => r.ootds));
    } catch (e) {
      showToast(e?.message || 'Erreur galerie', { type: 'error' });
    }
    setGalleryLoading(false);
  }, [competitionId, sortByScore, showToast]);

  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    try {
      const { data, error } = await supabase
        .from('competition_messages')
        .select('id, sender_id, content, image_url, created_at, is_deleted, profiles(username, avatar_url)')
        .eq('competition_id', competitionId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setMessages(data || []);
      await supabase.rpc('mark_competition_read', { p_competition_id: competitionId });
    } catch (e) {
      showToast(e?.message || 'Erreur messages', { type: 'error' });
    }
    setMessagesLoading(false);
  }, [competitionId, showToast]);

  useEffect(() => { loadRanking(); }, [loadRanking]);
  useEffect(() => { loadGallery(); }, [loadGallery]);
  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Un channel Realtime par compétition ouverte (les filtres postgres_changes
  // sont en égalité simple, donc un channel par compétition, pas un channel
  // global filtré sur une liste).
  useEffect(() => {
    const channel = supabase
      .channel(`competition-chat-${competitionId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'competition_messages',
        filter: `competition_id=eq.${competitionId}`,
      }, async (payload) => {
        if (payload.eventType === 'INSERT') {
          const { data: prof } = await supabase.from('profiles').select('username, avatar_url').eq('id', payload.new.sender_id).single();
          setMessages(prev => prev.some(m => m.id === payload.new.id) ? prev : [{ ...payload.new, profiles: prof }, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setMessages(prev => prev.map(m => (m.id === payload.new.id ? { ...m, ...payload.new } : m)));
        }
      })
      .subscribe();
    channelRef.current = channel;
    return () => supabase.removeChannel(channel);
  }, [competitionId]);

  const sendText = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || !userId) return;
    setSending(true);
    setText('');
    try {
      const { error } = await supabase.from('competition_messages').insert({
        competition_id: competitionId, sender_id: userId, content: trimmed,
      });
      if (error) throw error;
    } catch (e) {
      showToast(e?.message || 'Erreur envoi', { type: 'error' });
      setText(trimmed);
    }
    setSending(false);
  };

  const sendPhotoFromUri = async (uri) => {
    if (!userId || sending) return;
    setSending(true);
    try {
      const fileName = `messages/${userId}/${Date.now()}.jpg`;
      const fetchResponse = await fetch(uri);
      if (!fetchResponse.ok) throw new Error('Impossible de lire la photo');
      const blob = await fetchResponse.blob();
      await supabase.storage.from('ootds').upload(fileName, blob, { contentType: 'image/jpeg' });
      const { data: urlData } = supabase.storage.from('ootds').getPublicUrl(fileName);
      const { error } = await supabase.from('competition_messages').insert({
        competition_id: competitionId, sender_id: userId, image_url: urlData.publicUrl,
      });
      if (error) throw error;
    } catch (e) {
      showToast(e?.message || 'Erreur photo', { type: 'error' });
    }
    setSending(false);
  };

  const pickPhoto = async () => {
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const uri = URL.createObjectURL(file);
        await sendPhotoFromUri(uri);
      };
      input.click();
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast('Permission refusée pour accéder à la galerie', { type: 'warning' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, allowsEditing: false });
    if (!result.canceled) await sendPhotoFromUri(result.assets[0].uri);
  };

  const confirmDelete = (msg) => {
    if (msg.sender_id !== userId || msg.is_deleted) return;
    Alert.alert('Supprimer ce message ?', null, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => {
          setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, is_deleted: true, content: null, image_url: null } : m)));
          try {
            const { data, error } = await supabase.rpc('delete_competition_message', { p_id: msg.id });
            if (error || !data?.ok) throw new Error(error?.message || data?.error);
          } catch (e) {
            showToast(e?.message || 'Erreur suppression', { type: 'error' });
          }
        },
      },
    ]);
  };

  const shareInvite = async () => {
    try {
      const { data, error } = await supabase.rpc('create_competition_invite', { p_competition_id: competitionId });
      if (error || !data?.ok) throw new Error(error?.message || data?.error);
      const base = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://ootd-fr.vercel.app';
      await Share.share({ message: `Rejoins "${competitionName}" sur OOTD : ${base}/?join_competition=${data.token}` });
    } catch (e) {
      showToast(e?.message || 'Erreur invitation', { type: 'error' });
    }
  };

  const renderRankingItem = ({ item, index }) => {
    const mine = item.user_id === userId;
    const rank = index + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
    return (
      <View
        style={[
          styles.rankingRow,
          { borderColor: theme.border },
          mine && { backgroundColor: `${theme.accent}1A`, borderColor: theme.accent },
        ]}
      >
        <Text style={[styles.rankingRank, { color: theme.textPri }]}>{medal || rank}</Text>
        <Avatar uri={item.avatar_url} username={item.username} size={36} />
        <Text style={[styles.rankingUsername, { color: theme.textPri }]} numberOfLines={1}>
          {item.username || '?'}
        </Text>
        <Text style={[styles.rankingScore, { color: theme.textPri }]}>
          {item.best_score != null ? Math.round(item.best_score) : '—'}
        </Text>
        {item.streak_count > 0 && (
          <View style={styles.rankingStreakBadge}>
            <Text style={styles.rankingStreakText}>🔥{item.streak_count}</Text>
          </View>
        )}
      </View>
    );
  };

  const renderGalleryItem = ({ item }) => (
    <View style={styles.galleryItem}>
      <ExpoImage source={{ uri: item.ootds.image_url }} style={styles.galleryImage} contentFit="cover" />
      <View style={styles.galleryScoreBadge}>
        <Text style={styles.galleryScoreText}>{Math.round(item.ootds.score_global)}</Text>
      </View>
      <Text style={[styles.galleryUsername, { color: theme.textSub }]} numberOfLines={1}>
        {item.ootds.profiles?.username || '?'}
      </Text>
    </View>
  );

  const renderMessage = ({ item }) => {
    const mine = item.sender_id === userId;
    return (
      <TouchableOpacity
        activeOpacity={mine ? 0.7 : 1}
        onLongPress={() => confirmDelete(item)}
        style={[styles.msgRow, mine ? styles.msgRowMine : styles.msgRowTheirs]}
      >
        {!mine && <Avatar uri={item.profiles?.avatar_url} username={item.profiles?.username} size={28} />}
        <View style={[styles.bubble, { backgroundColor: mine ? theme.accent : theme.card, borderColor: theme.border }]}>
          {!mine && <Text style={[styles.senderName, { color: theme.textSub }]}>{item.profiles?.username || '?'}</Text>}
          {item.is_deleted ? (
            <Text style={[styles.deletedText, { color: mine ? '#fff9' : theme.textSub }]}>Message supprimé</Text>
          ) : item.image_url ? (
            <ExpoImage source={{ uri: item.image_url }} style={styles.msgImage} contentFit="cover" />
          ) : (
            <Text style={{ color: mine ? '#fff' : theme.textPri, fontSize: 14 }}>{item.content}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={theme.textPri} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPri }]} numberOfLines={1}>{competitionName}</Text>
        <TouchableOpacity onPress={shareInvite} hitSlop={10}>
          <Ionicons name="person-add-outline" size={22} color={theme.accent} />
        </TouchableOpacity>
      </View>

      <View style={[styles.tabs, { borderBottomColor: theme.border }]}>
        <TouchableOpacity style={styles.tabBtn} onPress={() => setTab('ranking')}>
          <Text style={[styles.tabText, { color: tab === 'ranking' ? theme.accent : theme.textSub }]}>Classement</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabBtn} onPress={() => setTab('gallery')}>
          <Text style={[styles.tabText, { color: tab === 'gallery' ? theme.accent : theme.textSub }]}>Galerie</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabBtn} onPress={() => setTab('chat')}>
          <Text style={[styles.tabText, { color: tab === 'chat' ? theme.accent : theme.textSub }]}>Chat</Text>
        </TouchableOpacity>
      </View>

      {tab === 'ranking' ? (
        <View style={{ flex: 1 }}>
          <View style={styles.periodRow}>
            {RANKING_PERIODS.map((p) => (
              <TouchableOpacity
                key={p.key}
                style={[
                  styles.periodPill,
                  { borderColor: theme.border },
                  period === p.key && { backgroundColor: theme.accent, borderColor: theme.accent },
                ]}
                onPress={() => setPeriod(p.key)}
              >
                <Text style={[styles.periodPillText, { color: period === p.key ? '#fff' : theme.textSub }]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {rankingLoading ? (
            <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={ranking?.ranking || []}
              keyExtractor={(item) => item.user_id}
              renderItem={renderRankingItem}
              contentContainerStyle={styles.rankingList}
              ListEmptyComponent={<Text style={[styles.empty, { color: theme.textSub }]}>Aucun classement pour l'instant.</Text>}
              ListFooterComponent={
                <>
                  {ranking?.most_regular && (
                    <View style={[styles.rankingHighlightBox, { borderColor: theme.border }]}>
                      <Text style={[styles.rankingHighlightText, { color: theme.textPri }]}>
                        🎯 Le plus régulier : {ranking.most_regular.username} · {ranking.most_regular.streak_count} jours
                      </Text>
                    </View>
                  )}
                  {ranking?.most_improved && (
                    <View style={[styles.rankingHighlightBox, { borderColor: theme.border }]}>
                      <Text style={[styles.rankingHighlightText, { color: theme.textPri }]}>
                        📈 Progression : {ranking.most_improved.username} · +{ranking.most_improved.delta} pts
                      </Text>
                    </View>
                  )}
                  {ranking?.most_liked && (
                    <View style={[styles.rankingHighlightBox, styles.rankingHighlightRow, { borderColor: theme.border }]}>
                      <Text style={[styles.rankingHighlightText, { color: theme.textPri }]}>
                        ❤️ Coup de cœur : {ranking.most_liked.username}
                      </Text>
                      <ExpoImage source={{ uri: ranking.most_liked.image_url }} style={styles.rankingLikedThumb} contentFit="cover" />
                    </View>
                  )}
                </>
              }
            />
          )}
        </View>
      ) : tab === 'gallery' ? (
        <>
          <TouchableOpacity style={styles.sortBtn} onPress={() => setSortByScore(v => !v)}>
            <Text style={[styles.sortText, { color: theme.textSub }]}>
              Trier par {sortByScore ? 'date' : 'score'} <Ionicons name="swap-vertical" size={13} />
            </Text>
          </TouchableOpacity>
          {galleryLoading ? (
            <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={gallery}
              keyExtractor={(item) => item.ootd_id}
              renderItem={renderGalleryItem}
              numColumns={3}
              contentContainerStyle={styles.galleryList}
              ListEmptyComponent={<Text style={[styles.empty, { color: theme.textSub }]}>Aucune tenue partagée pour l'instant.</Text>}
            />
          )}
        </>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {messagesLoading ? (
            <ActivityIndicator color={theme.accent} style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={messages}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              inverted
              contentContainerStyle={styles.msgList}
              ListEmptyComponent={<Text style={[styles.empty, { color: theme.textSub }]}>Aucun message pour l'instant.</Text>}
            />
          )}
          <View style={[styles.inputRow, { borderTopColor: theme.border }]}>
            <TouchableOpacity onPress={pickPhoto} hitSlop={8} disabled={sending}>
              <Ionicons name="image-outline" size={24} color={theme.accent} />
            </TouchableOpacity>
            <TextInput
              style={[styles.input, { backgroundColor: theme.card, color: theme.textPri }]}
              placeholder="Message..."
              placeholderTextColor={theme.textSub}
              value={text}
              onChangeText={setText}
              multiline
            />
            <TouchableOpacity onPress={sendText} hitSlop={8} disabled={!text.trim() || sending}>
              <Ionicons name="send" size={22} color={text.trim() ? theme.accent : theme.textSub} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  headerTitle: { fontSize: 16, fontWeight: '800', flex: 1, textAlign: 'center' },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabText: { fontWeight: '700', fontSize: 13.5 },
  periodRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  periodPill: { flex: 1, paddingVertical: 8, borderRadius: 20, borderWidth: 1, alignItems: 'center' },
  periodPillText: { fontSize: 11.5, fontWeight: '700' },
  rankingList: { padding: 12, gap: 8 },
  rankingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  rankingRank: { width: 26, textAlign: 'center', fontSize: 15, fontWeight: '800' },
  rankingUsername: { flex: 1, fontSize: 14, fontWeight: '600' },
  rankingScore: { fontSize: 15, fontWeight: '800', marginLeft: 6 },
  rankingStreakBadge: { marginLeft: 8, backgroundColor: '#FF6B0022', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  rankingStreakText: { fontSize: 11, fontWeight: '700', color: '#FF6B00' },
  rankingHighlightBox: { marginHorizontal: 4, marginTop: 8, padding: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  rankingHighlightRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rankingHighlightText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  rankingLikedThumb: { width: 40, height: 40, borderRadius: 8 },
  sortBtn: { alignSelf: 'flex-end', paddingHorizontal: 16, paddingTop: 10 },
  sortText: { fontSize: 12, fontWeight: '600' },
  galleryList: { padding: 8 },
  galleryItem: { width: '33.33%', padding: 4 },
  galleryImage: { width: '100%', aspectRatio: 1, borderRadius: 10, backgroundColor: '#0002' },
  galleryScoreBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: '#000A', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  galleryScoreText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  galleryUsername: { fontSize: 11, marginTop: 3, marginLeft: 2 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 13 },
  msgList: { padding: 12, gap: 10 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, maxWidth: '80%' },
  msgRowMine: { alignSelf: 'flex-end' },
  msgRowTheirs: { alignSelf: 'flex-start' },
  bubble: { borderRadius: 16, borderWidth: 1, padding: 10, maxWidth: '100%' },
  senderName: { fontSize: 10.5, fontWeight: '700', marginBottom: 3 },
  deletedText: { fontSize: 13, fontStyle: 'italic' },
  msgImage: { width: 180, height: 180, borderRadius: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 100 },
});
