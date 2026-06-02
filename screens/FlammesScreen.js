import { useState, useCallback, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet,
  FlatList, TouchableOpacity, ActivityIndicator,
  TextInput, ScrollView, Alert, KeyboardAvoidingView, Platform, Modal,
  useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode } from 'expo-av';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import { flammeOrderedIds } from '../lib/flammesUtils';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';
import { getLogoConfig } from '../lib/logoConfig';

function lastMsgTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  const diffHours = Math.floor((now - d) / 3600000);
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffMin < 1) return 'maintenant';
  if (diffHours < 1) return `${diffMin} min`;
  if (diffHours < 24) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Hier';
  return `${diffDays}j`;
}

/* ── Avatar with gradient ring ── */
function GradientAvatar({ uri, initial, size = 52, colors, theme, hasStory, showOnlineDot }) {
  const inner = size - 5;
  const borderW = hasStory ? 2.5 : 0;
  return (
    <View style={{ position: 'relative' }}>
      {hasStory ? (
        <LinearGradient
          colors={colors || ['#ED93B1', '#FF4567']}
          start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }}
          style={{ borderRadius: size / 2 + 2, padding: borderW }}
        >
          <View style={{ borderRadius: inner / 2, overflow: 'hidden', width: inner, height: inner, backgroundColor: theme.bg }}>
            {uri ? (
              <ExpoImage source={{ uri }} style={{ width: inner, height: inner }} contentFit="cover" />
            ) : (
              <View style={[{ width: inner, height: inner, backgroundColor: theme.accent + 'CC', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: Math.round(inner * 0.36) }}>{initial}</Text>
              </View>
            )}
          </View>
        </LinearGradient>
      ) : (
        <View style={{ borderRadius: size / 2, overflow: 'hidden', width: size, height: size, backgroundColor: theme.accent + 'CC' }}>
          {uri ? (
            <ExpoImage source={{ uri }} style={{ width: size, height: size }} contentFit="cover" />
          ) : (
            <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: Math.round(size * 0.36) }}>{initial}</Text>
            </View>
          )}
        </View>
      )}
      {showOnlineDot && (
        <View style={[styles.onlineDot, { borderColor: theme.bg, right: hasStory ? 2 : 1, bottom: hasStory ? 2 : 1 }]} />
      )}
    </View>
  );
}

export default function FlammesScreen() {
  const { width: ww } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const msgImgSize = Math.round(ww * 0.55);
  const [view, setView] = useState('list');
  const [friends, setFriends] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [outgoingPendingIds, setOutgoingPendingIds] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [stories, setStories] = useState([]);
  const [myStory, setMyStory] = useState(null);
  const [flammes, setFlammes] = useState([]);
  const [lastMessages, setLastMessages] = useState({});
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [storyPreview, setStoryPreview] = useState({ visible: false, videoUri: null, overlayText: '', caption: '', compressing: false, posting: false });
  const [storyViewer, setStoryViewer] = useState({ visible: false, story: null });
  const [myProfile, setMyProfile] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});
  const lastReadRef = useRef({});
  const { showToast } = useToast();
  const { theme } = useTheme();
  const navigation = useNavigation();
  const firstFocus = useRef(true);
  const [restoreModal, setRestoreModal] = useState({ visible: false, friend: null });
  const [restoring, setRestoring] = useState(false);
  const [profileModal, setProfileModal] = useState({ visible: false, profile: null, loading: false });

  useEffect(() => {
    AsyncStorage.getItem('@ootd_unread_last_read').then(raw => {
      if (raw) { try { lastReadRef.current = JSON.parse(raw); } catch (_) {} }
    });
  }, []);

  const fetchData = useCallback(async (opts = {}) => {
    const { silent = false } = opts;
    if (!silent) setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user?.id);
    if (!user) { if (!silent) setLoading(false); return; }

    // Verse les gels gratuits du mois si dû (idempotent côté serveur)
    try { await supabase.rpc('claim_monthly_freezes'); } catch (_) {}

    const [{ data: fd1 }, { data: fd2 }] = await Promise.all([
      supabase.from('friendships').select('friend_id').eq('user_id', user.id).eq('status', 'accepted'),
      supabase.from('friendships').select('user_id').eq('friend_id', user.id).eq('status', 'accepted'),
    ]);
    const friendIds = [...new Set([...(fd1 || []).map(r => r.friend_id), ...(fd2 || []).map(r => r.user_id)])];

    let profileById = {};
    let merged = [];
    {
      const { data: plist } = await supabase.from('profiles').select('id, username, avatar_url, active_logo, flame_freezes').in('id', [user.id, ...friendIds]);
      profileById = Object.fromEntries((plist || []).map(p => [p.id, p]));
      merged = friendIds.map(id => ({ id, ...profileById[id] })).filter(r => r.username != null);
    }
    setFriends(merged);
    setMyProfile(profileById[user.id] || null);

    const { data: incRows } = await supabase.from('friendships').select('user_id, created_at').eq('friend_id', user.id).eq('status', 'pending');
    const requesterIds = [...new Set((incRows || []).map(r => r.user_id))];
    let incomingWithProfiles = [];
    if (requesterIds.length) {
      const { data: reqProfs } = await supabase.from('profiles').select('id, username, avatar_url, active_logo').in('id', requesterIds);
      const reqById = Object.fromEntries((reqProfs || []).map(p => [p.id, p]));
      incomingWithProfiles = (incRows || []).map(r => ({
        user_id: r.user_id,
        created_at: r.created_at,
        profiles: reqById[r.user_id] || { id: r.user_id, username: 'Utilisateur', avatar_url: null },
      }));
    }
    setIncomingRequests(incomingWithProfiles);

    const { data: out } = await supabase.from('friendships').select('friend_id').eq('user_id', user.id).eq('status', 'pending');
    setOutgoingPendingIds((out || []).map(r => r.friend_id));

    const { data: flammesData } = await supabase.from('flammes').select('*').or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`);
    setFlammes(flammesData || []);

    const allIds = [user.id, ...friendIds];
    if (allIds.length) {
      const now = new Date().toISOString();
      const { data: storiesData } = await supabase
        .from('stories')
        .select('id, user_id, image_url, video_url, overlay_text, caption, expires_at')
        .in('user_id', allIds)
        .gt('expires_at', now)
        .order('created_at', { ascending: false });
      const activeStories = (storiesData || []).map(s => ({
        ...s,
        profiles: profileById[s.user_id]
          ? { username: profileById[s.user_id].username, avatar_url: profileById[s.user_id].avatar_url }
          : null,
      }));
      setStories(activeStories);
      setMyStory(activeStories.find(s => s.user_id === user.id) || null);
    } else {
      setStories([]);
      setMyStory(null);
    }

    // Dernier message par ami (pour preview dans la liste)
    if (friendIds.length) {
      const { data: msgsData } = await supabase
        .from('messages')
        .select('sender_id, receiver_id, content, image_url, created_at')
        .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(60);
      const byFriend = {};
      const counts = {};
      for (const msg of (msgsData || [])) {
        const fid = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
        if (!byFriend[fid]) byFriend[fid] = msg;
        if (msg.receiver_id === user.id) {
          const lastRead = lastReadRef.current[fid];
          if (!lastRead || msg.created_at > lastRead) {
            counts[fid] = (counts[fid] || 0) + 1;
          }
        }
      }
      setLastMessages(byFriend);
      setUnreadCounts(counts);
    }

    if (!silent) setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; fetchData(); }
    else { fetchData({ silent: true }); }
  }, [fetchData]));

  const ensureFlammesRow = async (otherId) => {
    await supabase.from('flammes').upsert(
      { ...flammeOrderedIds(userId, otherId), streak: 0, last_snap_at: new Date().toISOString() },
      { onConflict: 'user1_id,user2_id', ignoreDuplicates: true },
    );
  };

  const acceptRequest = async (requesterId) => {
    try {
      const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('user_id', requesterId).eq('friend_id', userId).eq('status', 'pending');
      if (error) throw error;
      await ensureFlammesRow(requesterId);
      await fetchData({ silent: true });
    } catch (e) { showToast(e?.message ?? 'Réessaie plus tard.', { type: 'error' }); }
  };

  const declineRequest = async (requesterId) => {
    try {
      const { error } = await supabase.from('friendships').delete().eq('user_id', requesterId).eq('friend_id', userId).eq('status', 'pending');
      if (error) throw error;
      await fetchData({ silent: true });
    } catch (e) { showToast(e?.message ?? 'Réessaie plus tard.', { type: 'error' }); }
  };

  const cancelOutgoing = async (targetId) => {
    Alert.alert('Annuler la demande ?', "L'autre utilisateur ne verra plus ta demande.", [
      { text: 'Non', style: 'cancel' },
      { text: 'Annuler', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('friendships').delete().eq('user_id', userId).eq('friend_id', targetId).eq('status', 'pending');
        if (!error) await fetchData({ silent: true });
      }},
    ]);
  };

  const sendFriendRequest = async (friendId) => {
    if (!userId || friendId === userId) return;
    if (friends.some(f => f.id === friendId)) { Alert.alert('Déjà amis'); return; }
    const theyRequested = incomingRequests.find(r => r.user_id === friendId);
    if (theyRequested) { await acceptRequest(friendId); return; }
    if (outgoingPendingIds.includes(friendId)) { Alert.alert('Demande déjà envoyée'); return; }
    try {
      const { error } = await supabase.from('friendships').insert({ user_id: userId, friend_id: friendId, status: 'pending' });
      if (error) {
        if (error.code === '23505') { await fetchData({ silent: true }); return; }
        throw error;
      }
      Alert.alert('Demande envoyée', 'Cette personne devra valider ta demande.');
      await fetchData({ silent: true });
    } catch (e) { Alert.alert('Envoi impossible', e?.message ?? 'Réessaie plus tard.'); }
  };

  const searchUsers = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    const { data } = await supabase.from('profiles').select('id, username, avatar_url, active_logo').ilike('username', `%${query}%`).neq('id', userId).limit(12);
    setSearchResults(data || []);
  };

  const relationForSearchProfile = (targetId) => {
    if (friends.some(f => f.id === targetId)) return 'friend';
    if (incomingRequests.some(r => r.user_id === targetId)) return 'incoming';
    if (outgoingPendingIds.includes(targetId)) return 'outgoing';
    return 'none';
  };

  const renderSearchAction = (item) => {
    const rel = relationForSearchProfile(item.id);
    if (rel === 'friend') return <View style={[styles.pillMuted, { backgroundColor: theme.card }]}><Text style={[styles.pillMutedText, { color: theme.textSub }]}>Amis</Text></View>;
    if (rel === 'incoming') return (
      <View style={styles.incomingBtnsSearch}>
        <TouchableOpacity style={[styles.acceptBtnSmall, { backgroundColor: theme.accent }]} onPress={() => acceptRequest(item.id)}>
          <Text style={styles.acceptBtnSmallText}>Accepter</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.refuseMini} onPress={() => declineRequest(item.id)}>
          <Feather name="x" size={18} color="#ff6b6b" />
        </TouchableOpacity>
      </View>
    );
    if (rel === 'outgoing') return (
      <TouchableOpacity style={[styles.pendingBtn, { borderColor: theme.accent + '55' }]} onPress={() => cancelOutgoing(item.id)}>
        <Text style={[styles.pendingBtnText, { color: theme.accent }]}>Demandée</Text>
      </TouchableOpacity>
    );
    return (
      <TouchableOpacity style={[styles.addBtn, { backgroundColor: theme.accent }]} onPress={() => sendFriendRequest(item.id)}>
        <Text style={styles.addBtnText}>Demander</Text>
      </TouchableOpacity>
    );
  };

  // ── État d'une flamme (dérivé de last_snap_at) ─────────────────────────────
  //   âge <= 24h        → active
  //   24h < âge <= 72h  → expired (grisée, restaurable via gel, fenêtre 48h)
  //   âge > 72h         → dead (définitivement à 0)
  const FLAME_EXPIRE_MS  = 24 * 3600 * 1000;
  const FLAME_RESTORE_MS = 72 * 3600 * 1000;

  const getFlamme = (friendId) => flammes.find(f =>
    (f.user1_id === userId && f.user2_id === friendId) ||
    (f.user1_id === friendId && f.user2_id === userId),
  );

  const getFlammeInfo = (friendId) => {
    const flamme = getFlamme(friendId);
    if (!flamme || !flamme.streak) return { flamme: flamme || null, streak: 0, state: 'none' };
    const age = Date.now() - (flamme.last_snap_at ? new Date(flamme.last_snap_at).getTime() : 0);
    if (age <= FLAME_EXPIRE_MS)  return { flamme, streak: flamme.streak, state: 'active' };
    if (age <= FLAME_RESTORE_MS) return { flamme, streak: flamme.streak, state: 'expired' };
    return { flamme, streak: 0, state: 'dead' };
  };

  // ── Restauration manuelle d'une flamme éteinte via un Gel de Flamme ────────
  const openRestore = (friend) => setRestoreModal({ visible: true, friend });

  const goToShop = () => { try { navigation.navigate('Shop'); } catch (_) {} };

  const openUserProfile = async (targetId) => {
    setProfileModal({ visible: true, profile: null, loading: true });
    const { data } = await supabase.from('profiles').select('id, username, avatar_url, bio, active_logo').eq('id', targetId).single();
    setProfileModal({ visible: true, profile: data || null, loading: false });
  };

  const renderProfileModal = () => (
    <Modal visible={profileModal.visible} transparent animationType="fade" onRequestClose={() => setProfileModal({ visible: false, profile: null, loading: false })}>
      <TouchableOpacity activeOpacity={1} style={styles.profileModalOverlay} onPress={() => setProfileModal({ visible: false, profile: null, loading: false })}>
        <TouchableOpacity activeOpacity={1} style={[styles.profileModalCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {profileModal.loading ? (
            <ActivityIndicator color={theme.accent} size="large" style={{ padding: 32 }} />
          ) : profileModal.profile ? (() => {
            const lc = getLogoConfig(profileModal.profile.active_logo);
            return (
              <>
                <GradientAvatar
                  uri={profileModal.profile.avatar_url}
                  initial={profileModal.profile.username?.[0]?.toUpperCase()}
                  size={80}
                  colors={lc.frameBorderColor ? [lc.frameBorderColor, lc.frameBorderColor] : ['#ED93B1', '#FF4567']}
                  theme={theme}
                  hasStory={false}
                  showOnlineDot={false}
                />
                <View style={styles.profileModalNameRow}>
                  <Text style={[styles.profileModalName, { color: theme.textPri }]}>@{profileModal.profile.username}</Text>
                  {lc.badge ? <Text style={{ fontSize: 18 }}>{lc.badge}</Text> : null}
                </View>
                {profileModal.profile.bio ? (
                  <Text style={[styles.profileModalBio, { color: theme.textSub }]}>{profileModal.profile.bio}</Text>
                ) : null}
              </>
            );
          })() : <Text style={{ color: theme.textSub }}>Profil introuvable</Text>}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );

  const doRestore = async () => {
    const friend = restoreModal.friend;
    if (!friend || restoring) return;
    const info = getFlammeInfo(friend.id);
    if (!info.flamme) { setRestoreModal({ visible: false, friend: null }); return; }
    setRestoring(true);
    try {
      const { data, error } = await supabase.rpc('restore_flamme', { p_flamme_id: info.flamme.id });
      if (error) throw error;
      if (!data?.ok) {
        if (data?.error === 'no_freeze') { setRestoring(false); return; }
        throw new Error(data?.error === 'window_closed'
          ? 'Trop tard : la fenêtre de 48h est passée'
          : (data?.error || 'Restauration impossible'));
      }
      showToast('🔥 Flamme ranimée !', { type: 'success' });
      setRestoreModal({ visible: false, friend: null });
      await fetchData({ silent: true });
    } catch (e) {
      showToast(e?.message || 'Erreur', { type: 'error' });
    }
    setRestoring(false);
  };

  const renderRestoreModal = () => {
    const friend  = restoreModal.friend;
    const freezes = myProfile?.flame_freezes || 0;
    const info    = friend ? getFlammeInfo(friend.id) : { streak: 0 };
    return (
      <Modal visible={restoreModal.visible} transparent animationType="fade" onRequestClose={() => setRestoreModal({ visible: false, friend: null })}>
        <TouchableOpacity activeOpacity={1} style={styles.restoreOverlay} onPress={() => setRestoreModal({ visible: false, friend: null })}>
          <TouchableOpacity activeOpacity={1} style={[styles.restoreCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={styles.restoreEmoji}>🥶</Text>
            <Text style={[styles.restoreTitle, { color: theme.textPri }]}>Flamme éteinte</Text>
            <Text style={[styles.restoreSub, { color: theme.textSub }]}>
              Ta série de {info.streak} jour{info.streak > 1 ? 's' : ''}{friend ? ` avec ${friend.username}` : ''} s'est éteinte. Tu peux la ranimer dans les 48h.
            </Text>
            {freezes > 0 ? (
              <>
                <TouchableOpacity style={[styles.restoreBtn, { backgroundColor: theme.accent }]} onPress={doRestore} disabled={restoring}>
                  {restoring
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.restoreBtnTxt}>❄️ Utilisez mon gel de flammes</Text>}
                </TouchableOpacity>
                <Text style={[styles.restoreHint, { color: theme.textSub }]}>{freezes} gel{freezes > 1 ? 's' : ''} en stock</Text>
              </>
            ) : (
              <>
                <Text style={[styles.restoreSub, { color: theme.textSub }]}>Tu n'as plus de gel de flamme.</Text>
                <TouchableOpacity style={[styles.restoreBtn, { backgroundColor: theme.accent }]} onPress={() => { setRestoreModal({ visible: false, friend: null }); goToShop(); }}>
                  <Text style={styles.restoreBtnTxt}>Acheter un gel · 0,99€</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity onPress={() => setRestoreModal({ visible: false, friend: null })}>
              <Text style={[styles.restoreCancel, { color: theme.textSub }]}>Plus tard</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  };

  const loadMessages = useCallback(async (friend) => {
    if (!userId || !friend) return;
    const now = new Date().toISOString();
    const { data } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${friend.id}),and(sender_id.eq.${friend.id},receiver_id.eq.${userId})`)
      .gt('expires_at', now)
      .order('created_at', { ascending: true });
    setMessages(data || []);
  }, [userId]);

  const openChat = async (friend) => {
    const now = new Date().toISOString();
    const updated = { ...lastReadRef.current, [friend.id]: now };
    lastReadRef.current = updated;
    AsyncStorage.setItem('@ootd_unread_last_read', JSON.stringify(updated));
    setUnreadCounts(prev => ({ ...prev, [friend.id]: 0 }));
    setSelectedFriend(friend);
    setView('chat');
    await loadMessages(friend);
  };

  // ── Like / suppression de messages (synchro temps réel) ────────────────────
  const lastTapRef = useRef({ id: null, t: 0 });

  // Abonnement realtime : likes, suppressions et messages entrants de la conversation
  useEffect(() => {
    if (!userId || !selectedFriend) return;
    const channel = supabase
      .channel(`chat-${userId}-${selectedFriend.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new && payload.new.id ? payload.new : payload.old;
        if (!row) return;
        const inPair =
          (row.sender_id === userId && row.receiver_id === selectedFriend.id) ||
          (row.sender_id === selectedFriend.id && row.receiver_id === userId);
        if (!inPair) return;
        if (payload.eventType === 'INSERT') {
          setMessages((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
        } else if (payload.eventType === 'UPDATE') {
          setMessages((prev) => prev.map((m) => (m.id === payload.new.id ? { ...m, ...payload.new } : m)));
        } else if (payload.eventType === 'DELETE') {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, selectedFriend]);

  const toggleLike = async (msg) => {
    if (msg.sender_id === userId || msg.is_deleted) return; // on ne like que les messages reçus
    const next = !msg.is_liked;
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_liked: next } : m)));
    try {
      const { data, error } = await supabase.rpc('toggle_message_like', { p_id: msg.id, p_liked: next });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Erreur');
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_liked: !next } : m)));
      showToast(e.message || 'Action impossible', { type: 'error' });
    }
  };

  const handleBubbleTap = (msg) => {
    if (msg.sender_id === userId || msg.is_deleted) return;
    const now = Date.now();
    if (lastTapRef.current.id === msg.id && now - lastTapRef.current.t < 300) {
      lastTapRef.current = { id: null, t: 0 };
      toggleLike(msg);
    } else {
      lastTapRef.current = { id: msg.id, t: now };
    }
  };

  const deleteMessage = async (msg) => {
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_deleted: true, content: null, image_url: null } : m)));
    try {
      const { data, error } = await supabase.rpc('delete_message', { p_id: msg.id });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Suppression impossible');
      const img = data.image_url;
      if (img) {
        try {
          const marker = '/storage/v1/object/public/';
          const i = img.indexOf(marker);
          if (i !== -1) {
            const rest = img.slice(i + marker.length);
            const bucket = rest.split('/')[0];
            const path = rest.split('/').slice(1).join('/');
            if (bucket && path) await supabase.storage.from(bucket).remove([decodeURIComponent(path)]);
          }
        } catch (_) {}
      }
    } catch (e) {
      console.error('[deleteMessage]', e);
      showToast(e.message || 'Suppression impossible', { type: 'error' });
      loadMessages(selectedFriend);
    }
  };

  const handleBubbleLongPress = (msg) => {
    if (msg.is_deleted) return;
    if (msg.sender_id !== userId) { toggleLike(msg); return; }
    // Message que j'ai envoyé → suppression (Alert.alert sans boutons sur web → window.confirm)
    if (Platform.OS === 'web') {
      const ok = typeof window !== 'undefined' && window.confirm ? window.confirm('Supprimer ce message ?') : true;
      if (ok) deleteMessage(msg);
      return;
    }
    Alert.alert('Supprimer', 'Supprimer ce message ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer le message', style: 'destructive', onPress: () => deleteMessage(msg) },
    ]);
  };

  // Notifie le destinataire via web push (best-effort, ne bloque jamais l'envoi).
  const notifyFriend = (friendId, title, body) => {
    if (!friendId) return;
    supabase.functions
      .invoke('send-web-push', { body: { recipient_id: friendId, title, body, url: '/' } })
      .catch(() => {});
  };

  const sendTextMessage = async () => {
    if (!messageText.trim() || !selectedFriend || sendingMessage) return;
    setSendingMessage(true);
    const text = messageText.trim();
    setMessageText('');
    try {
      const { error } = await supabase.from('messages').insert({ sender_id: userId, receiver_id: selectedFriend.id, content: text });
      if (error) throw error;
      await loadMessages(selectedFriend);
      notifyFriend(selectedFriend.id, myProfile?.username || 'Nouveau message', text.slice(0, 120));
    } catch (e) { showToast(e?.message || 'Envoi impossible', { type: 'error' }); }
    setSendingMessage(false);
  };

  const sendPhotoMessage = async () => {
    if (!selectedFriend || sendingMessage) return;
    // Tente la caméra en premier ; si refusé → repli galerie
    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    let result;
    if (camPerm.granted) {
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, allowsEditing: true, aspect: [1, 1] });
    } else {
      const libPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!libPerm.granted) return;
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, allowsEditing: true, aspect: [1, 1] });
    }
    if (result.canceled) return;
    setSendingMessage(true);
    try {
      const fileName = `messages/${userId}/${Date.now()}.jpg`;
      const fetchResponse = await fetch(result.assets[0].uri);
      if (!fetchResponse.ok) throw new Error('Impossible de lire la photo');
      const blob = await fetchResponse.blob();
      await supabase.storage.from('ootds').upload(fileName, blob, { contentType: 'image/jpeg' });
      const { data: urlData } = supabase.storage.from('ootds').getPublicUrl(fileName);
      const { error } = await supabase.from('messages').insert({ sender_id: userId, receiver_id: selectedFriend.id, image_url: urlData.publicUrl });
      if (error) throw error;
      await loadMessages(selectedFriend);
      notifyFriend(selectedFriend.id, myProfile?.username || 'OOTD', '📸 t\'a envoyé une photo');
      const flamme = flammes.find(f =>
        (f.user1_id === userId && f.user2_id === selectedFriend.id) ||
        (f.user1_id === selectedFriend.id && f.user2_id === userId),
      );
      const now = new Date();
      if (flamme) {
        const lastSnap = flamme.last_snap_at ? new Date(flamme.last_snap_at) : new Date(0);
        const nowDay = now.toISOString().split('T')[0];
        const lastSnapDay = lastSnap.toISOString().split('T')[0];
        const daysDiff = Math.round((new Date(nowDay) - new Date(lastSnapDay)) / 86400000);
        // Restauration d'une série éteinte = action manuelle via le Gel de Flamme
        // (clic sur la flamme grisée dans le chat). Ici, simple progression / reset.
        const newStreak = daysDiff <= 1 ? flamme.streak + 1 : 1;
        await supabase.from('flammes').update({ streak: newStreak, last_snap_at: now.toISOString() }).eq('id', flamme.id);
      } else {
        await supabase.from('flammes').insert({ ...flammeOrderedIds(userId, selectedFriend.id), streak: 1, last_snap_at: now.toISOString() });
      }
      await fetchData({ silent: true });
    } catch (e) { showToast(e?.message || 'Erreur photo', { type: 'error' }); }
    setSendingMessage(false);
  };

  const postStory = async () => {
    if (Platform.OS === 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { showToast('Permission refusée', { type: 'warning' }); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsEditing: false });
      if (result.canceled) return;
      setStoryPreview({ visible: true, videoUri: result.assets[0].uri, overlayText: '', caption: '', compressing: false, posting: false });
      return;
    }
    const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
    if (!cameraPermission.granted) { showToast('Permission caméra refusée', { type: 'warning' }); return; }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: 30,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType?.Medium ?? 0.5,
      allowsEditing: false,
    });
    if (result.canceled) return;
    setStoryPreview({ visible: true, videoUri: result.assets[0].uri, overlayText: '', caption: '', compressing: false, posting: false });
  };

  const publishStory = async () => {
    if (!storyPreview.videoUri || storyPreview.posting) return;
    setStoryPreview(prev => ({ ...prev, posting: true }));

    try {
      const videoUri = storyPreview.videoUri;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Session expirée. Reconnecte-toi.');

      const fileName = `${userId}/${Date.now()}.mp4`;

      if (Platform.OS === 'web') {
        // Sur web, fetch().blob() fonctionne correctement (pas de contrainte mémoire native)
        const fetchResponse = await fetch(videoUri);
        const blob = await fetchResponse.blob();
        const { error: uploadError } = await supabase.storage
          .from('stories')
          .upload(fileName, blob, { contentType: blob.type || 'video/mp4', upsert: false });
        if (uploadError) throw uploadError;
      } else {
        // XHR + FormData : seule méthode fiable pour les gros fichiers vidéo sur Android.
        // fetch().blob() + supabase.storage.upload() échoue avec "Network request failed"
        // car la totalité du fichier est chargée en mémoire avant l'envoi HTTP.
        await new Promise((resolve, reject) => {
          const form = new FormData();
          form.append('', { uri: videoUri, name: `${Date.now()}.mp4`, type: 'video/mp4' });

          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${ENV.supabaseUrl}/storage/v1/object/stories/${fileName}`);
          xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
          xhr.setRequestHeader('x-upsert', 'false');
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`Upload échoué (${xhr.status})`));
            }
          };
          xhr.onerror = () => {
            reject(new Error('Erreur réseau lors de l\'upload vidéo'));
          };
          xhr.send(form);
        });
      }

      const { data: urlData } = supabase.storage.from('stories').getPublicUrl(fileName);

      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const { error: insErr } = await supabase.from('stories').insert({
        user_id: userId,
        video_url: urlData.publicUrl,
        overlay_text: storyPreview.overlayText.trim() || null,
        caption: storyPreview.caption.trim() || null,
        expires_at: expiresAt,
      });
      if (insErr) throw insErr;

      setStoryPreview({ visible: false, videoUri: null, overlayText: '', caption: '', compressing: false, posting: false });
      await fetchData({ silent: true });
      showToast('Story publiée ! Elle disparaît dans 24h', { type: 'success' });
    } catch (e) {
      setStoryPreview(prev => ({ ...prev, posting: false }));
      showToast(e?.message || 'Impossible de publier la story', { type: 'error' });
    }
  };

  if (loading) return (
    <View style={[styles.center, { backgroundColor: theme.bg }]}>
      <ActivityIndicator color={theme.accent} size="large" />
    </View>
  );

  /* ── Vue CHAT ── */
  if (view === 'chat' && selectedFriend) {
    const chatLogoConfig = getLogoConfig(selectedFriend.active_logo);
    const chatFlamme = getFlammeInfo(selectedFriend.id);
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]} edges={['top']}>
        {/* Header chat */}
        <View style={[styles.chatHeader, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => { setView('list'); setMessages([]); }} style={styles.backBtn}>
            <Feather name="chevron-left" size={26} color={theme.textPri} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.chatHeaderInfo} onPress={() => openUserProfile(selectedFriend.id)} activeOpacity={0.8}>
            <GradientAvatar
              uri={selectedFriend.avatar_url}
              initial={selectedFriend.username?.[0]?.toUpperCase()}
              size={40}
              colors={chatLogoConfig.frameBorderColor ? [chatLogoConfig.frameBorderColor, chatLogoConfig.frameBorderColor] : ['#ED93B1', '#FF4567']}
              theme={theme}
              hasStory={stories.some(s => s.user_id === selectedFriend.id)}
              showOnlineDot
            />
            <View>
              <View style={styles.convNameRow}>
                <Text style={[styles.chatUsername, { color: theme.textPri }]}>{selectedFriend.username}</Text>
                {chatLogoConfig.badge ? <Text style={styles.convNameBadge}>{chatLogoConfig.badge}</Text> : null}
              </View>
              {chatFlamme.state === 'active' && chatFlamme.streak > 0 && (
                <Text style={[styles.chatStreak, { color: theme.accent }]}>🔥 {chatFlamme.streak} j</Text>
              )}
              {chatFlamme.state === 'expired' && (
                <TouchableOpacity onPress={() => openRestore(selectedFriend)}>
                  <Text style={[styles.chatStreak, styles.flammeDim, { color: theme.textSub }]}>🔥 {chatFlamme.streak} j · ranimer</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoMsgBtn} onPress={sendPhotoMessage} disabled={sendingMessage}>
            <Feather name="camera" size={22} color={theme.textPri} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
          <ScrollView style={[styles.msgList, { backgroundColor: theme.bg }]} contentContainerStyle={styles.msgListContent} keyboardShouldPersistTaps="handled">
            {messages.length === 0 ? (
              <View style={styles.msgEmpty}>
                <Feather name="message-circle" size={40} color={theme.border} />
                <Text style={[styles.msgEmptyText, { color: theme.textPri }]}>Début de la conversation</Text>
                <Text style={[styles.msgEmptySub, { color: theme.textSub }]}>Les messages disparaissent après 24h</Text>
              </View>
            ) : messages.map(msg => {
              const mine = msg.sender_id === userId;
              return (
              <View key={msg.id} style={[styles.msgRow, mine ? styles.msgRowRight : styles.msgRowLeft]}>
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => handleBubbleTap(msg)}
                  onLongPress={() => handleBubbleLongPress(msg)}
                  delayLongPress={350}
                  style={[
                    styles.bubble,
                    mine
                      ? [styles.bubbleSent, { backgroundColor: theme.accent + '22', borderColor: theme.accent + '44', borderWidth: 1 }]
                      : [styles.bubbleRecv, { backgroundColor: theme.card }],
                  ]}
                >
                  {msg.is_deleted ? (
                    <Text style={[styles.bubbleDeleted, { color: theme.textSub }]}>Ce message a été supprimé</Text>
                  ) : (
                    <>
                      {msg.content ? <Text style={[styles.bubbleText, { color: theme.textPri }]}>{msg.content}</Text> : null}
                      {msg.image_url ? (
                        <ExpoImage source={{ uri: msg.image_url }} style={[styles.msgImage, { width: msgImgSize, height: msgImgSize }]} contentFit="cover" />
                      ) : null}
                    </>
                  )}
                  <Text style={[styles.msgTime, { color: theme.textSub }]}>
                    {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  {msg.is_liked && !msg.is_deleted && (
                    <View style={[styles.likeBadge, mine ? styles.likeBadgeLeft : styles.likeBadgeRight, { backgroundColor: theme.bg }]}>
                      <Text style={styles.likeBadgeText}>❤️</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
              );
            })}
          </ScrollView>

          <View style={[styles.inputBar, { backgroundColor: theme.bg, borderTopColor: theme.border }]}>
            <TextInput
              style={[styles.msgInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
              placeholder="Écrire un message..."
              placeholderTextColor={theme.textSub}
              value={messageText}
              onChangeText={setMessageText}
              multiline
              maxLength={500}
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: theme.accent }, (!messageText.trim() || sendingMessage) && { opacity: 0.45 }]}
              onPress={sendTextMessage}
              disabled={!messageText.trim() || sendingMessage}
            >
              {sendingMessage
                ? <ActivityIndicator color="#fff" size="small" />
                : <Feather name="send" size={16} color="#fff" />
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
        {renderRestoreModal()}
        {renderProfileModal()}
      </SafeAreaView>
    );
  }

  /* ── Vue LISTE ── */
  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {renderRestoreModal()}
      {/* Modals story viewer / story preview */}
      <Modal visible={storyViewer.visible} transparent animationType="fade" onRequestClose={() => setStoryViewer({ visible: false, story: null })}>
        <View style={styles.viewerOverlay}>
          <View style={styles.viewerHeader}>
            <Text style={styles.viewerUsername}>@{storyViewer.story?.profiles?.username || 'Story'}</Text>
            <TouchableOpacity onPress={() => setStoryViewer({ visible: false, story: null })}>
              <Feather name="x" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
          {storyViewer.story?.video_url ? (
            <Video source={{ uri: storyViewer.story.video_url }} style={styles.viewerMedia} resizeMode={ResizeMode.CONTAIN} useNativeControls shouldPlay isLooping={false} />
          ) : storyViewer.story?.image_url ? (
            <ExpoImage source={{ uri: storyViewer.story.image_url }} style={styles.viewerMedia} contentFit="contain" />
          ) : null}
          {storyViewer.story?.overlay_text ? <View style={styles.viewerOverlayTextWrap}><Text style={styles.viewerOverlayText}>{storyViewer.story.overlay_text}</Text></View> : null}
          {storyViewer.story?.caption ? <View style={styles.viewerCaptionWrap}><Text style={styles.viewerCaption}>{storyViewer.story.caption}</Text></View> : null}
        </View>
      </Modal>

      <Modal visible={storyPreview.visible} transparent animationType="slide" onRequestClose={() => { if (!storyPreview.posting) setStoryPreview(prev => ({ ...prev, visible: false })); }}>
        <View style={styles.storyModalOverlay}>
          <View style={[styles.storyModalSheet, { backgroundColor: theme.card }]}>
            <Text style={[styles.storyModalTitle, { color: theme.textPri }]}>Prévisualisation story</Text>
            <View style={styles.storyVideoWrap}>
              {storyPreview.videoUri ? (
                <Video
                  source={{ uri: storyPreview.videoUri }}
                  style={styles.storyVideoPreview}
                  resizeMode={ResizeMode.CONTAIN}
                  useNativeControls
                  shouldPlay={false}
                  isLooping={false}
                />
              ) : (
                <Feather name="video" size={36} color={theme.textSub} />
              )}
            </View>
            <Text style={[styles.storyFieldLabel, { color: theme.textSub }]}>Texte sur la vidéo (optionnel)</Text>
            <TextInput style={[styles.storyFieldInput, { backgroundColor: theme.bg, borderColor: theme.border, color: theme.textPri }]} placeholder="Ex : Mon look du jour ✨" placeholderTextColor={theme.textSub} value={storyPreview.overlayText} onChangeText={t => setStoryPreview(prev => ({ ...prev, overlayText: t }))} maxLength={60} editable={!storyPreview.posting} />
            <Text style={[styles.storyFieldLabel, { color: theme.textSub }]}>Description (optionnel)</Text>
            <TextInput style={[styles.storyFieldInput, styles.storyFieldInputMulti, { backgroundColor: theme.bg, borderColor: theme.border, color: theme.textPri }]} placeholder="Décris ta tenue..." placeholderTextColor={theme.textSub} value={storyPreview.caption} onChangeText={t => setStoryPreview(prev => ({ ...prev, caption: t }))} maxLength={200} multiline editable={!storyPreview.posting} />
            <View style={styles.storyModalBtns}>
              <TouchableOpacity style={[styles.storyModalCancel, { backgroundColor: theme.border }]} onPress={() => setStoryPreview(prev => ({ ...prev, visible: false }))} disabled={storyPreview.posting}>
                <Text style={[styles.storyModalCancelText, { color: theme.textPri }]}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.storyModalPublish, { backgroundColor: theme.accent }, storyPreview.posting && { opacity: 0.6 }]} onPress={publishStory} disabled={storyPreview.posting}>
                {storyPreview.posting ? <ActivityIndicator color="#3a0d1e" size="small" /> : <Text style={styles.storyModalPublishText}>Publier</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.textPri }]}>Chat</Text>
          <TouchableOpacity onPress={() => setShowSearch(!showSearch)} hitSlop={10} style={styles.headerSearchBtn}>
            <Feather name={showSearch ? 'x' : 'search'} size={22} color={theme.textPri} />
          </TouchableOpacity>
        </View>

        {/* Barre de recherche */}
        <View style={styles.searchBarWrap}>
          <View style={[styles.searchBarInner, { backgroundColor: theme.card }]}>
            <Feather name="search" size={16} color={theme.textSub} />
            <TextInput
              style={[styles.searchBarInput, { color: theme.textPri }]}
              placeholder="Rechercher"
              placeholderTextColor={theme.textSub}
              value={searchQuery}
              onChangeText={searchUsers}
            />
          </View>
        </View>

        {showSearch && searchQuery.length >= 2 ? (
          <FlatList
            data={searchResults}
            keyExtractor={it => it.id}
            renderItem={({ item }) => {
              const slc = getLogoConfig(item.active_logo);
              return (
                <View style={[styles.searchResult, { borderBottomColor: theme.border }]}>
                  <TouchableOpacity style={styles.searchResultLeft} onPress={() => openUserProfile(item.id)} activeOpacity={0.75}>
                    <GradientAvatar uri={item.avatar_url} initial={item.username?.[0]?.toUpperCase()} size={44} colors={slc.frameBorderColor ? [slc.frameBorderColor, slc.frameBorderColor] : ['#ED93B1', '#FF4567']} theme={theme} hasStory={false} showOnlineDot={false} />
                    <View style={styles.convNameRow}>
                      <Text style={[styles.searchUsername, { color: theme.textPri }]}>{item.username}</Text>
                      {slc.badge ? <Text style={styles.convNameBadge}>{slc.badge}</Text> : null}
                    </View>
                  </TouchableOpacity>
                  {renderSearchAction(item)}
                </View>
              );
            }}
            ListEmptyComponent={<Text style={[styles.noResults, { color: theme.textSub }]}>Aucun résultat</Text>}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4 }}
          />
        ) : (
          <FlatList
            data={friends}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <>
                {/* Demandes d'ami */}
                {incomingRequests.length > 0 && (
                  <View style={styles.incomingWrap}>
                    <Text style={[styles.sectionLabel, { color: theme.textPri }]}>Demandes</Text>
                    {incomingRequests.map(req => {
                      const rLC = getLogoConfig(req.profiles?.active_logo);
                      return (
                        <View key={req.user_id} style={[styles.incomingCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                          <GradientAvatar uri={req.profiles?.avatar_url} initial={req.profiles?.username?.[0]?.toUpperCase() ?? '?'} size={44} theme={theme} hasStory={false} showOnlineDot={false} colors={['#ED93B1', '#FF4567']} />
                          <View style={styles.incomingBody}>
                            <View style={styles.convNameRow}>
                              <Text style={[styles.incomingUsername, { color: theme.textPri }]}>@{req.profiles?.username ?? 'utilisateur'}</Text>
                              {rLC.badge ? <Text style={styles.convNameBadge}>{rLC.badge}</Text> : null}
                            </View>
                            <Text style={[styles.incomingSub, { color: theme.textSub }]}>Veut te rejoindre</Text>
                          </View>
                          <View style={styles.incomingBtns}>
                            <TouchableOpacity style={[styles.acceptBtn, { backgroundColor: theme.accent }]} onPress={() => acceptRequest(req.user_id)}>
                              <Text style={styles.acceptBtnText}>Accepter</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.refuseBtn, { borderColor: theme.border }]} onPress={() => declineRequest(req.user_id)}>
                              <Feather name="x" size={16} color="#ff6b6b" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Stories horizontales */}
                <View style={[styles.storiesSection, { borderBottomColor: theme.border }]}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesRow}>
                    {/* Ta story */}
                    <TouchableOpacity style={styles.storyItem} onPress={() => myStory ? setStoryViewer({ visible: true, story: myStory }) : postStory()}>
                      <View style={[styles.myStoryCircle, { borderColor: theme.accent }]}>
                        {myStory ? (
                          <GradientAvatar
                            uri={myProfile?.avatar_url}
                            initial={myProfile?.username?.[0]?.toUpperCase() || '?'}
                            size={58}
                            colors={['#ED93B1', '#FF4567']}
                            theme={theme}
                            hasStory={true}
                            showOnlineDot={false}
                          />
                        ) : (
                          <View style={[styles.myStoryEmpty, { borderColor: theme.accent, backgroundColor: theme.bg }]}>
                            <View style={[styles.myStoryPlusBadge, { backgroundColor: theme.accent }]}>
                              <Feather name="plus" size={14} color="#fff" />
                            </View>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.storyName, { color: theme.textSub }]} numberOfLines={1}>Ta story</Text>
                    </TouchableOpacity>

                    {/* Stories amis */}
                    {friends.map(friend => {
                      const friendStory = stories.find(s => s.user_id === friend.id);
                      return (
                        <TouchableOpacity key={friend.id} style={styles.storyItem} onPress={() => friendStory && setStoryViewer({ visible: true, story: friendStory })}>
                          <GradientAvatar
                            uri={friend.avatar_url}
                            initial={friend.username?.[0]?.toUpperCase()}
                            size={58}
                            colors={['#ED93B1', '#FF4567']}
                            theme={theme}
                            hasStory={!!friendStory}
                            showOnlineDot
                          />
                          <Text style={[styles.storyName, { color: theme.textSub }]} numberOfLines={1}>{friend.username}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </>
            }
            renderItem={({ item }) => {
              const fi = getFlammeInfo(item.id);
              const lc = getLogoConfig(item.active_logo);
              const lastMsg = lastMessages[item.id];
              const hasStory = stories.some(s => s.user_id === item.id);
              const lastMsgPreview = lastMsg?.image_url ? '📸 Photo' : lastMsg?.content || 'Envoie un message...';
              const msgTime = lastMsg ? lastMsgTime(lastMsg.created_at) : '';
              return (
                <TouchableOpacity style={[styles.convRow, { borderBottomColor: theme.border }]} onPress={() => openChat(item)} activeOpacity={0.75}>
                  <GradientAvatar
                    uri={item.avatar_url}
                    initial={item.username?.[0]?.toUpperCase()}
                    size={54}
                    colors={lc.frameBorderColor ? [lc.frameBorderColor, lc.frameBorderColor] : ['#ED93B1', '#FF4567']}
                    theme={theme}
                    hasStory={hasStory}
                    showOnlineDot
                  />
                  <View style={styles.convInfo}>
                    <View style={styles.convNameRow}>
                      <Text style={[styles.convName, { color: theme.textPri }]}>{item.username}</Text>
                      {lc.badge ? <Text style={styles.convNameBadge}>{lc.badge}</Text> : null}
                    </View>
                    <Text style={[styles.convSub, { color: theme.textSub }]} numberOfLines={1}>{lastMsgPreview}</Text>
                  </View>
                  <View style={styles.convRight}>
                    {msgTime ? <Text style={[styles.convTime, { color: theme.textSub }]}>{msgTime}</Text> : null}
                    {unreadCounts[item.id] > 0 && (
                      <View style={[styles.unreadBadge, { backgroundColor: theme.accent }]}>
                        <Text style={styles.unreadBadgeText}>
                          {unreadCounts[item.id] > 99 ? '99+' : unreadCounts[item.id]}
                        </Text>
                      </View>
                    )}
                    {fi.state === 'active' && fi.streak > 0 && (
                      <View style={styles.streakRow}>
                        <Text style={[styles.streakText, { color: theme.accent }]}>🔥 {fi.streak}</Text>
                      </View>
                    )}
                    {fi.state === 'expired' && (
                      <TouchableOpacity style={styles.streakRow} onPress={() => openRestore(item)}>
                        <Text style={[styles.streakText, styles.flammeDim, { color: theme.textSub }]}>🔥 {fi.streak}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Feather name="users" size={44} color={theme.border} />
                <Text style={[styles.emptyText, { color: theme.textPri }]}>Aucun ami encore</Text>
                <Text style={[styles.emptySub, { color: theme.textSub }]}>Cherche des amis avec la loupe</Text>
                <TouchableOpacity style={[styles.findBtn, { backgroundColor: theme.accent }]} onPress={() => setShowSearch(true)}>
                  <Text style={styles.findBtnText}>Trouver des amis</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )}
      </SafeAreaView>

      {/* FAB nouveau message */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.accent, bottom: insets.bottom + 86 }]}
        onPress={() => setShowSearch(true)}
        activeOpacity={0.85}
      >
        <Feather name="edit-2" size={20} color="#fff" />
      </TouchableOpacity>
      {renderProfileModal()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:      { paddingBottom: 100 },

  /* Header */
  header: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10,
  },
  title: { fontSize: 22, fontWeight: '800' },
  headerSearchBtn: { position: 'absolute', right: 20, top: 6 },

  /* Barre recherche */
  searchBarWrap: { paddingHorizontal: 16, marginBottom: 10 },
  searchBarInner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 24, paddingHorizontal: 14, paddingVertical: 10,
  },
  searchBarInput: { flex: 1, fontSize: 15, paddingVertical: 0 },

  onlineDot: {
    position: 'absolute',
    width: 13, height: 13,
    borderRadius: 7,
    backgroundColor: '#4CD964',
    borderWidth: 2,
  },

  /* Stories */
  storiesSection: { paddingTop: 4, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 4 },
  storiesRow: { paddingHorizontal: 12, gap: 14 },
  storyItem:  { alignItems: 'center', width: 66 },
  myStoryCircle: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  myStoryEmpty: {
    width: 58, height: 58, borderRadius: 29,
    borderWidth: 2, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  myStoryInner: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  myStoryPlusBadge: {
    position: 'absolute', bottom: -3, right: -3,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FAF7F5',
  },
  storyName: { fontSize: 11, marginTop: 5, textAlign: 'center', maxWidth: 62 },

  /* Conversations */
  convRow:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  convInfo:     { flex: 1 },
  convName:     { fontWeight: '700', fontSize: 15 },
  convNameRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  convNameBadge:{ fontSize: 12 },
  convSub:      { fontSize: 13, marginTop: 2 },
  convRight:    { alignItems: 'flex-end', gap: 5, minWidth: 52 },
  unreadBadge:  { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  unreadBadgeText: { color: '#3a0d1e', fontWeight: '800', fontSize: 11 },
  convTime:     { fontSize: 12 },
  streakRow:    { flexDirection: 'row', alignItems: 'center' },
  streakText:   { fontWeight: '700', fontSize: 13 },
  flammeDim:    { opacity: 0.4 },

  // Modal de restauration de flamme
  restoreOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 28 },
  restoreCard:    { width: '100%', borderRadius: 22, borderWidth: 1, padding: 24, alignItems: 'center', gap: 10 },
  restoreEmoji:   { fontSize: 44 },
  restoreTitle:   { fontSize: 19, fontWeight: '900' },
  restoreSub:     { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  restoreBtn:     { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', alignSelf: 'stretch', marginTop: 6 },
  restoreBtnTxt:  { color: '#fff', fontWeight: '800', fontSize: 14 },
  restoreHint:    { fontSize: 11, marginTop: 2 },
  restoreCancel:  { fontSize: 13, fontWeight: '600', marginTop: 8, paddingVertical: 4 },

  /* Demandes */
  incomingWrap: { paddingHorizontal: 16, paddingBottom: 4, paddingTop: 4 },
  sectionLabel: { fontWeight: '700', fontSize: 14, paddingVertical: 8 },
  incomingCard: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    padding: 12, borderRadius: 16, marginBottom: 8, borderWidth: 1, gap: 10,
  },
  incomingBody:     { flex: 1, minWidth: 100 },
  incomingUsername: { fontWeight: '700', fontSize: 15 },
  incomingSub:      { fontSize: 12, marginTop: 2 },
  incomingBtns:     { flexDirection: 'row', width: '100%', marginTop: 8, gap: 10 },
  acceptBtn:        { flex: 1, borderRadius: 12, alignItems: 'center', paddingVertical: 10 },
  acceptBtnText:    { color: '#3a0d1e', fontWeight: '800', fontSize: 13 },
  refuseBtn:        { width: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', paddingVertical: 10 },

  /* Search results */
  searchResult: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  searchUsername: { fontWeight: '600', fontSize: 15, flex: 1 },
  noResults:      { textAlign: 'center', marginTop: 20, fontSize: 14 },
  addBtn:         { borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnText:     { color: '#3a0d1e', fontWeight: '700', fontSize: 13 },
  pendingBtn:     { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1 },
  pendingBtnText: { fontWeight: '700', fontSize: 12 },
  pillMuted:      { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  pillMutedText:  { fontWeight: '700', fontSize: 12 },
  incomingBtnsSearch: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  acceptBtnSmall:     { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  acceptBtnSmallText: { color: '#3a0d1e', fontWeight: '800', fontSize: 13 },
  refuseMini:         { paddingHorizontal: 8, paddingVertical: 6 },

  /* Empty */
  empty:       { alignItems: 'center', padding: 48, gap: 10 },
  emptyText:   { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptySub:    { fontSize: 13, textAlign: 'center' },
  findBtn:     { borderRadius: 22, paddingHorizontal: 24, paddingVertical: 12, marginTop: 6 },
  findBtnText: { color: '#3a0d1e', fontWeight: '700', fontSize: 15 },

  /* FAB */
  fab: {
    position: 'absolute',
    right: 20,
    width: 52, height: 52,
    borderRadius: 26,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#ED93B1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },

  /* Chat */
  chatHeader:      { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  backBtn:         { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  chatHeaderInfo:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatUsername:    { fontWeight: '700', fontSize: 15 },
  chatStreak:      { fontSize: 11, fontWeight: '600', marginTop: 1 },
  photoMsgBtn:     { padding: 8 },
  msgList:         { flex: 1 },
  msgListContent:  { padding: 16, gap: 8, paddingBottom: 24 },
  msgEmpty:        { alignItems: 'center', paddingTop: 48, gap: 10 },
  msgEmptyText:    { fontSize: 16, fontWeight: '600' },
  msgEmptySub:     { fontSize: 12 },
  msgRow:          { maxWidth: '78%' },
  msgRowRight:     { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgRowLeft:      { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble:          { borderRadius: 18, padding: 12, maxWidth: '100%' },
  bubbleSent:      { borderBottomRightRadius: 4 },
  bubbleRecv:      { borderBottomLeftRadius: 4 },
  bubbleText:      { fontSize: 14, lineHeight: 20 },
  bubbleDeleted:   { fontSize: 13, fontStyle: 'italic' },
  msgImage:        { borderRadius: 12, marginBottom: 4 },
  msgTime:         { fontSize: 10, marginTop: 4 },
  likeBadge:       { position: 'absolute', bottom: -9, borderRadius: 11, paddingHorizontal: 3, paddingVertical: 1 },
  likeBadgeLeft:   { left: -6 },
  likeBadgeRight:  { right: -6 },
  likeBadgeText:   { fontSize: 13 },
  inputBar:        { flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  msgInput:        { flex: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, maxHeight: 100, borderWidth: 1 },
  sendBtn:         { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },

  /* Story modal */
  storyModalOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  storyModalSheet:      { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 },
  storyModalTitle:      { fontSize: 17, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  storyVideoWrap:       { borderRadius: 16, overflow: 'hidden', height: 260, marginBottom: 20, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  storyVideoPreview:    { width: '100%', height: '100%' },
  storyFieldLabel:      { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  storyFieldInput:      { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 14, borderWidth: 1 },
  storyFieldInputMulti: { minHeight: 72, textAlignVertical: 'top' },
  storyModalBtns:       { flexDirection: 'row', gap: 10, marginTop: 4 },
  storyModalCancel:     { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  storyModalCancelText: { fontWeight: '600', fontSize: 15 },
  storyModalPublish:    { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  storyModalPublishText:{ color: '#3a0d1e', fontWeight: '800', fontSize: 15 },
  storyModalBtnRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },

  /* Mini-profil public */
  profileModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  profileModalCard:    { width: '100%', borderRadius: 24, borderWidth: 1, padding: 28, alignItems: 'center', gap: 10 },
  profileModalNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  profileModalName:    { fontWeight: '800', fontSize: 18 },
  profileModalBio:     { fontSize: 13, textAlign: 'center', lineHeight: 19 },

  /* Zone gauche cliquable dans les résultats de recherche */
  searchResultLeft:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },

  /* Story viewer */
  viewerOverlay:         { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  viewerHeader:          { position: 'absolute', top: 56, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, zIndex: 10 },
  viewerUsername:        { color: '#fff', fontWeight: '700', fontSize: 16 },
  viewerMedia:           { width: '100%', height: '80%' },
  viewerOverlayTextWrap: { position: 'absolute', bottom: 120, left: 20, right: 20, alignItems: 'center' },
  viewerOverlayText:     { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  viewerCaptionWrap:     { position: 'absolute', bottom: 60, left: 20, right: 20, alignItems: 'center' },
  viewerCaption:         { color: 'rgba(255,255,255,0.85)', fontSize: 14, textAlign: 'center' },
});
