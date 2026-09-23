import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Share,
  Animated, PanResponder, useWindowDimensions, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/toastContext';
import { setActiveCompetition } from '../lib/activeChat';
import { getLocalDayIsoRange } from '../lib/competitionUtils';
import { useCompetitionFonts, FONT_DISPLAY, FONT_BODY } from '../lib/competitionFonts';
import Avatar from '../components/Avatar';

// ===========================================================================
// Écran Compétition v4 ("gestes séparés") — 2026-09-27
// Reproduit fidèlement une maquette HTML validée par l'utilisateur (podium +
// classement complet, carrousel des tenues du jour, chat de groupe avec
// swipe-to-reply/likes/réactions, viewer plein écran à gestes directionnels
// séparés). Remplace l'ancienne structure à 3 onglets (Classement/Galerie/
// Chat) par 2 "pages" glissables : Photos & chat, puis Classement.
//
// Palette FIXE, volontairement indépendante du thème clair/sombre du reste de
// l'app (useTheme()) — cet écran garde le look sombre précis de la maquette
// approuvée ("C'est exactement ce que je recherchais").
// ===========================================================================

const C = {
  bgPage: '#0B0710', bgGlow: '#2A0F1E', bgBase: '#0D0810',
  bgElevated: '#18101B', bgElevated2: '#211722',
  borderSoft: 'rgba(237,147,177,0.16)', borderSoft2: 'rgba(237,147,177,0.08)',
  accent: '#ED93B1', accentStrong: '#D45C86',
  violet: '#8E7BE0', gold: '#FFC94D', silver: '#C9CFDA', bronze: '#D89A66',
  streak: '#FF8A4C', love: '#FF5C7A',
  textPri: '#F6EEF2', textSub: '#AE94A0', textFaint: '#7C6670',
  onAccent: '#3A0F22',
};

const REACT_EMOJIS = ['😂', '🔥', '❤️', '😮', '👍'];
const RANKING_PERIODS = [
  { key: 'day', label: 'Jour' },
  { key: 'week', label: 'Semaine' },
  { key: 'month', label: 'Mois' },
  { key: 'all', label: 'Toujours' },
];
const MESSAGES_LIMIT = 100; // V1 sans pagination (comme l'ancien chat 1-à-1 avant son passage en FlatList)
const SCORE_MAX = { fit: 33, harmonie: 34, detail: 33 }; // score_coupe/score_couleurs/score_tendance

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function gaugePct(value, max) {
  if (value == null) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function aggregateReactions(rows) {
  const map = new Map();
  (rows || []).forEach(r => map.set(r.emoji, (map.get(r.emoji) || 0) + 1));
  return Array.from(map.entries()).map(([emoji, count]) => ({ emoji, count }));
}

function mapMessageRow(row, userId) {
  return {
    id: row.id,
    sender_id: row.sender_id,
    content: row.content,
    image_url: row.image_url,
    created_at: row.created_at,
    is_deleted: row.is_deleted,
    reply_to_id: row.reply_to_id,
    quoted_label: row.quoted_label,
    profiles: row.profiles,
    likeCount: (row.competition_message_likes || []).length,
    likedByMe: (row.competition_message_likes || []).some(l => l.user_id === userId),
    reactions: aggregateReactions(row.competition_message_reactions),
    myReactionEmojis: new Set((row.competition_message_reactions || []).filter(r => r.user_id === userId).map(r => r.emoji)),
  };
}

// ---------------------------------------------------------------------------
// Ligne de message (redesign 2026-09-30, plus de boutons visibles) :
// - swipe vers la droite = répondre (inchangé, PanResponder axis-locked) ;
// - double-tap sur la bulle = liker (cœur animé façon Instagram, pas de
//   compteur permanent affiché à côté d'un bouton) ;
// - appui long sur la bulle = ouvre le popover de réactions emoji (avant
//   déclenché par un bouton "😊+" séparé) — pour ses propres messages, ce
//   même popover ajoute une option de suppression (l'appui long servait
//   avant UNIQUEMENT à supprimer ses propres messages : ce rôle est repris
//   dans le popover pour ne pas perdre la fonctionnalité).
// Le PanResponder n'engage le drag horizontal que si le mouvement est
// nettement horizontal (|dx|>10 et dominant sur dy) — sinon le scroll vertical
// natif du parent reste prioritaire, exactement comme dans la maquette.
// ---------------------------------------------------------------------------
function MessageRow({ message, isMine, quoteText, popoverOpen, onTogglePopover, onSwipeReply, onToggleLike, onPickReaction, onDelete }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const iconOpacity = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(0)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;
  const lastTapAt = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dx > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        const t = Math.min(g.dx, 64);
        translateX.setValue(Math.max(t, 0));
        iconOpacity.setValue(Math.min(Math.max(t, 0) / 50, 1));
      },
      onPanResponderRelease: (_, g) => {
        Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        Animated.timing(iconOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        if (g.dx > 42) onSwipeReply(message);
      },
      onPanResponderTerminate: () => {
        translateX.setValue(0);
        iconOpacity.setValue(0);
      },
    })
  ).current;

  const playHeartBurst = () => {
    heartScale.setValue(0.4);
    heartOpacity.setValue(1);
    Animated.spring(heartScale, { toValue: 1.15, friction: 4, tension: 60, useNativeDriver: true }).start(() => {
      Animated.timing(heartOpacity, { toValue: 0, duration: 320, delay: 200, useNativeDriver: true }).start();
    });
  };

  const handleTap = () => {
    if (message.is_deleted) return;
    const now = Date.now();
    if (now - lastTapAt.current < 280) {
      lastTapAt.current = 0;
      onToggleLike(message);
      playHeartBurst();
    } else {
      lastTapAt.current = now;
    }
  };

  return (
    <View style={[rs.row, isMine && rs.rowOut]}>
      <Animated.View pointerEvents="none" style={[rs.replyIcon, { opacity: iconOpacity }]}>
        <Ionicons name="arrow-undo" size={15} color={C.accent} />
      </Animated.View>
      {!isMine && <Avatar uri={message.profiles?.avatar_url} username={message.profiles?.username} size={28} borderWidth={0} />}
      <Animated.View {...panResponder.panHandlers} style={[rs.col, isMine && rs.colOut, { transform: [{ translateX }] }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleTap}
          onLongPress={() => !message.is_deleted && onTogglePopover(message.id)}
          delayLongPress={350}
        >
          {(message.reply_to_id || message.quoted_label) && !message.is_deleted && (
            <View style={[rs.quote, isMine && rs.quoteOut]}>
              <Text style={rs.quoteText} numberOfLines={1}>{message.quoted_label || quoteText || 'Message'}</Text>
            </View>
          )}
          <View style={[rs.bubble, isMine ? rs.bubbleOut : rs.bubbleIn]}>
            {message.is_deleted ? (
              <Text style={rs.deletedText}>Message supprimé</Text>
            ) : message.image_url ? (
              <ExpoImage source={{ uri: message.image_url }} style={rs.bubbleImage} contentFit="cover" />
            ) : (
              <Text style={[rs.bubbleText, isMine ? rs.bubbleTextOut : rs.bubbleTextIn]}>{message.content}</Text>
            )}
            <Animated.View pointerEvents="none" style={[rs.heartBurst, { opacity: heartOpacity, transform: [{ scale: heartScale }] }]}>
              <Text style={rs.heartBurstEmoji}>❤️</Text>
            </Animated.View>
          </View>
        </TouchableOpacity>

        {!message.is_deleted && (
          <View style={rs.metaRow}>
            <Text style={rs.metaTime}>{fmtTime(message.created_at)}</Text>
            {popoverOpen && (
              <View style={rs.reactPopover}>
                {REACT_EMOJIS.map(e => (
                  <TouchableOpacity key={e} onPress={() => onPickReaction(message, e)} hitSlop={4}>
                    <Text style={rs.reactPopoverEmoji}>{e}</Text>
                  </TouchableOpacity>
                ))}
                {isMine && (
                  <TouchableOpacity onPress={() => { onTogglePopover(message.id); onDelete(message); }} hitSlop={4} style={rs.reactPopoverDelete}>
                    <Ionicons name="trash-outline" size={15} color={C.love} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {(message.likeCount > 0 || message.reactions.length > 0) && (
          <View style={rs.reactsRow}>
            {message.likeCount > 0 && (
              <View style={[rs.reactChip, message.likedByMe && rs.reactChipLiked]}>
                <Text style={rs.reactChipText}>❤️{message.likeCount > 1 ? ` ${message.likeCount}` : ''}</Text>
              </View>
            )}
            {message.reactions.map(r => (
              <View key={r.emoji} style={rs.reactChip}>
                <Text style={rs.reactChipText}>{r.emoji}{r.count > 1 ? ` ${r.count}` : ''}</Text>
              </View>
            ))}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

export default function CompetitionScreen({ route, navigation }) {
  const { competitionId, competitionName } = route.params || {};
  const { showToast } = useToast();
  const { width } = useWindowDimensions();
  // Même piège que todaysPhotosRef ci-dessous : pagerResponder et fsResponder
  // sont tous deux des useRef(PanResponder.create(...)).current, donc figés au
  // premier rendu — lire `width` en direct dedans le fige aussi (recalcul de
  // layout si la fenêtre est redimensionnée/pivotée sur ce PWA web, ex. rotation
  // d'écran) plutôt que de suivre l'écran courant. Trouvé en revue adversariale
  // du fix todaysPhotos (2026-09-30) — même classe de bug, déclencheur différent.
  const widthRef = useRef(width);
  useEffect(() => { widthRef.current = width; }, [width]);

  const [userId, setUserId] = useState(null);
  const [createdBy, setCreatedBy] = useState(null); // pour n'afficher "Supprimer" qu'au créateur
  const [menuOpen, setMenuOpen] = useState(false);

  // ---- Page pager (Photos & chat <-> Classement) ----
  const [panelIndex, setPanelIndexState] = useState(0);
  const panelIndexRef = useRef(0);
  const setPanelIndex = (idx) => { panelIndexRef.current = idx; setPanelIndexState(idx); };
  const pagerX = useRef(new Animated.Value(0)).current;

  // ---- Tenues du jour ----
  const [todaysPhotos, setTodaysPhotos] = useState([]);
  const [todaysLoading, setTodaysLoading] = useState(true);
  // Miroir en ref, lu par fsResponder (useRef(PanResponder.create(...)).current
  // ne garde QUE le rendu initial : ses closures d'onPanResponderMove/Release
  // restent figées pour toujours sur le state du premier rendu — todaysPhotos
  // y valait encore [] à ce moment (chargé de façon async par loadTodaysPhotos
  // après résolution de userId). Lire todaysPhotos directement dedans le
  // condamnait à toujours voir un tableau vide, cassant silencieusement le
  // swipe gauche/droite ET le swipe vers le haut du viewer plein écran (bug
  // réel diagnostiqué le 2026-09-30, confirmé par 2 investigations indépendantes).
  const todaysPhotosRef = useRef([]);
  useEffect(() => { todaysPhotosRef.current = todaysPhotos; }, [todaysPhotos]);

  // ---- Chat ----
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // {id, label, snippet}
  const [activePopoverId, setActivePopoverId] = useState(null);
  const pcScrollRef = useRef(null);
  const textInputRef = useRef(null);

  // ---- Classement ----
  const [ranking, setRanking] = useState(null);
  const [rankingLoading, setRankingLoading] = useState(true);
  const [period, setPeriod] = useState('week');

  // ---- Viewer plein écran ----
  const [fsOpen, setFsOpenState] = useState(false);
  const fsOpenRef = useRef(false);
  const setFsOpen = (v) => { fsOpenRef.current = v; setFsOpenState(v); };
  const [fsIndex, setFsIndexState] = useState(0);
  const fsIndexRef = useRef(0);
  const setFsIndex = (idx) => { fsIndexRef.current = idx; setFsIndexState(idx); };
  const [fsReplyOpen, setFsReplyOpenState] = useState(false);
  const fsReplyOpenRef = useRef(false);
  const setFsReplyOpen = (v) => { fsReplyOpenRef.current = v; setFsReplyOpenState(v); };
  const [fsReplyText, setFsReplyText] = useState('');
  const fsTrackX = useRef(new Animated.Value(0)).current;
  const fsOverlayTranslateY = useRef(new Animated.Value(0)).current;
  const fsOverlayOpacity = useRef(new Animated.Value(1)).current;
  const fsOverlayScale = useRef(new Animated.Value(1)).current;
  const fsReplyInputRef = useRef(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id || null));
  }, []);

  useEffect(() => {
    supabase.from('competitions').select('created_by').eq('id', competitionId).single()
      .then(({ data }) => setCreatedBy(data?.created_by || null));
  }, [competitionId]);

  useEffect(() => {
    setActiveCompetition(competitionId);
    return () => setActiveCompetition(null);
  }, [competitionId]);

  // ================= Tenues du jour (une par membre) =================
  const loadTodaysPhotos = useCallback(async () => {
    setTodaysLoading(true);
    try {
      const { data: members, error: mErr } = await supabase
        .from('competition_members')
        .select('user_id, profiles(username, avatar_url)')
        .eq('competition_id', competitionId);
      if (mErr) throw mErr;
      const { startIso, endIso } = getLocalDayIsoRange();
      const { data: todays, error: tErr } = await supabase
        .from('ootd_competitions')
        .select('user_id, created_at, ootds(id, image_url, score_global, score_couleurs, score_coupe, score_tendance)')
        .eq('competition_id', competitionId)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: false });
      if (tErr) throw tErr;
      const byUser = new Map();
      (todays || []).forEach(row => { if (row.ootds && !byUser.has(row.user_id)) byUser.set(row.user_id, row.ootds); });
      const list = (members || []).map(m => ({
        userId: m.user_id,
        username: m.profiles?.username || '?',
        avatarUrl: m.profiles?.avatar_url || null,
        ootd: byUser.get(m.user_id) || null,
      }));
      list.sort((a, b) => (a.userId === userId ? -1 : b.userId === userId ? 1 : 0));
      setTodaysPhotos(list);
    } catch (e) {
      showToast(e?.message || 'Erreur chargement des tenues du jour', { type: 'error' });
    }
    setTodaysLoading(false);
  }, [competitionId, userId, showToast]);

  useEffect(() => { if (userId) loadTodaysPhotos(); }, [userId, loadTodaysPhotos]);

  // ================= Chat =================
  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    try {
      const { data, error } = await supabase
        .from('competition_messages')
        // profiles!competition_messages_sender_id_fkey (pas juste "profiles(...)") :
        // depuis l'ajout de competition_message_likes/reactions (2026-09-27), ces 2
        // tables ont chacune une FK vers competition_messages ET vers profiles —
        // PostgREST les traite comme des tables de jonction many-to-many possibles
        // vers profiles, ce qui rend l'embed "profiles(...)" nu ambigu (3 chemins
        // candidats). Le hint !fkey force explicitement la relation directe
        // sender_id -> profiles voulue ici (confirmé en prod, PGRST201).
        .select('id, sender_id, content, image_url, created_at, is_deleted, reply_to_id, quoted_label, profiles!competition_messages_sender_id_fkey(username, avatar_url), competition_message_likes(user_id), competition_message_reactions(user_id, emoji)')
        .eq('competition_id', competitionId)
        .order('created_at', { ascending: true })
        .limit(MESSAGES_LIMIT);
      if (error) throw error;
      setMessages((data || []).map(row => mapMessageRow(row, userId)));
      await supabase.rpc('mark_competition_read', { p_competition_id: competitionId });
    } catch (e) {
      showToast(e?.message || 'Erreur messages', { type: 'error' });
    }
    setMessagesLoading(false);
  }, [competitionId, userId, showToast]);

  useEffect(() => { if (userId) loadMessages(); }, [userId, loadMessages]);

  useEffect(() => {
    const channel = supabase
      .channel(`competition-chat-${competitionId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'competition_messages',
        filter: `competition_id=eq.${competitionId}`,
      }, async (payload) => {
        if (payload.eventType === 'INSERT') {
          const { data: prof } = await supabase.from('profiles').select('username, avatar_url').eq('id', payload.new.sender_id).single();
          const mapped = mapMessageRow({ ...payload.new, profiles: prof, competition_message_likes: [], competition_message_reactions: [] }, userId);
          setMessages(prev => prev.some(m => m.id === mapped.id) ? prev : [...prev, mapped]);
        } else if (payload.eventType === 'UPDATE') {
          setMessages(prev => prev.map(m => (m.id === payload.new.id
            ? { ...m, is_deleted: payload.new.is_deleted, content: payload.new.is_deleted ? null : payload.new.content, image_url: payload.new.is_deleted ? null : payload.new.image_url }
            : m)));
        }
      })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [competitionId, userId]);

  const messagesById = useMemo(() => {
    const map = new Map();
    messages.forEach(m => map.set(m.id, m));
    return map;
  }, [messages]);

  function resolveQuoteText(m) {
    if (!m.reply_to_id) return null;
    const orig = messagesById.get(m.reply_to_id);
    if (!orig) return 'Message';
    const label = orig.sender_id === userId ? 'Toi' : (orig.profiles?.username || '?');
    const snippet = orig.is_deleted ? 'Message supprimé' : (orig.content || (orig.image_url ? '📷 Photo' : ''));
    return `${label} : ${snippet}`;
  }

  async function insertMessage({ content = null, imageUrl = null, replyToId = null, quotedLabel = null }) {
    try {
      const { error } = await supabase.from('competition_messages').insert({
        competition_id: competitionId, sender_id: userId,
        content, image_url: imageUrl, reply_to_id: replyToId, quoted_label: quotedLabel,
      });
      if (error) throw error;
      setTimeout(() => pcScrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      showToast(e?.message || 'Erreur envoi', { type: 'error' });
    }
  }

  const sendText = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || !userId) return;
    setSending(true);
    setText('');
    await insertMessage({ content: trimmed, replyToId: replyTo?.id || null });
    setReplyTo(null);
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
      await insertMessage({ imageUrl: urlData.publicUrl, replyToId: replyTo?.id || null });
      setReplyTo(null);
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

  function handleSwipeReply(message) {
    const label = message.sender_id === userId ? 'Toi' : (message.profiles?.username || '?');
    const snippet = message.is_deleted ? 'Message supprimé' : (message.content || (message.image_url ? '📷 Photo' : ''));
    setReplyTo({ id: message.id, label: `Réponse à ${label}`, snippet });
    setTimeout(() => textInputRef.current?.focus(), 200);
  }

  async function toggleLike(message) {
    const wasLiked = message.likedByMe;
    const prevCount = message.likeCount;
    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, likedByMe: !wasLiked, likeCount: m.likeCount + (wasLiked ? -1 : 1) } : m));
    try {
      const { data, error } = await supabase.rpc('toggle_competition_message_like', { p_message_id: message.id });
      if (error || !data?.ok) throw new Error(error?.message || data?.error);
      setMessages(prev => prev.map(m => m.id === message.id ? { ...m, likedByMe: data.liked, likeCount: data.like_count } : m));
    } catch (e) {
      setMessages(prev => prev.map(m => m.id === message.id ? { ...m, likedByMe: wasLiked, likeCount: prevCount } : m));
      showToast(e?.message || 'Erreur', { type: 'error' });
    }
  }

  async function pickReaction(message, emoji) {
    setActivePopoverId(null);
    if (message.myReactionEmojis.has(emoji)) return;
    setMessages(prev => prev.map(m => {
      if (m.id !== message.id) return m;
      const nextSet = new Set(m.myReactionEmojis); nextSet.add(emoji);
      const existing = m.reactions.find(r => r.emoji === emoji);
      const nextReactions = existing
        ? m.reactions.map(r => (r.emoji === emoji ? { ...r, count: r.count + 1 } : r))
        : [...m.reactions, { emoji, count: 1 }];
      return { ...m, myReactionEmojis: nextSet, reactions: nextReactions };
    }));
    try {
      const { data, error } = await supabase.rpc('add_competition_message_reaction', { p_message_id: message.id, p_emoji: emoji });
      if (error || !data?.ok) throw new Error(error?.message || data?.error);
    } catch (e) {
      showToast(e?.message || 'Erreur réaction', { type: 'error' });
      loadMessages();
    }
  }

  // ================= Classement =================
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
  useEffect(() => { loadRanking(); }, [loadRanking]);

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

  // ================= Quitter / Supprimer (audit règles métier, 2026-09-29) =================
  // Confirmation cross-plateforme établie ailleurs dans l'app (ex. RecapScreen.deleteOotd) :
  // Alert.alert n'a pas de vrais boutons sur react-native-web → window.confirm sur web.
  const confirmThen = (message, onConfirm) => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm ? window.confirm(message) : true) onConfirm();
      return;
    }
    Alert.alert(message, null, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Confirmer', style: 'destructive', onPress: onConfirm },
    ]);
  };

  const doLeaveCompetition = async () => {
    try {
      const { data, error } = await supabase.rpc('leave_competition', { p_competition_id: competitionId });
      if (error || !data?.ok) throw new Error(error?.message || data?.error);
      showToast('Tu as quitté la compétition', { type: 'success' });
      navigation.goBack();
    } catch (e) {
      showToast(e?.message || 'Erreur', { type: 'error' });
    }
  };

  const doDeleteCompetition = async () => {
    try {
      const { data, error } = await supabase.rpc('delete_competition', { p_competition_id: competitionId });
      if (error || !data?.ok) throw new Error(error?.message || data?.error);
      showToast('Compétition supprimée', { type: 'success' });
      navigation.goBack();
    } catch (e) {
      showToast(e?.message || 'Erreur', { type: 'error' });
    }
  };

  const leaveCompetition = () => {
    setMenuOpen(false);
    confirmThen(
      'Quitter définitivement cette compétition ? Tu pourras la rejoindre à nouveau uniquement avec un nouveau lien d\'invitation.',
      doLeaveCompetition,
    );
  };
  const deleteCompetition = () => {
    setMenuOpen(false);
    confirmThen(
      'Supprimer définitivement cette compétition pour tous les membres ? Cette action est irréversible.',
      doDeleteCompetition,
    );
  };

  // ================= Pager de page (Photos&chat <-> Classement) =================
  // Lit widthRef.current (pas width) : pagerResponder (frozen, voir plus bas)
  // n'appelle jamais que la copie de applyPanel figée à son tout premier rendu —
  // passer par la ref garantit que même cette copie fige lit la largeur actuelle
  // au moment de l'appel plutôt que celle du montage.
  const applyPanel = useCallback((idx, animated = true) => {
    setPanelIndex(idx);
    Animated.timing(pagerX, { toValue: -idx * widthRef.current, duration: animated ? 320 : 0, useNativeDriver: true }).start();
  }, [pagerX]);

  const pagerResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => !fsOpenRef.current && Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        const w = widthRef.current;
        const next = Math.max(Math.min(-panelIndexRef.current * w + g.dx, w * 0.18), -w - w * 0.18);
        pagerX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const threshold = widthRef.current * 0.2;
        let next = panelIndexRef.current;
        if (g.dx < -threshold && panelIndexRef.current === 0) next = 1;
        else if (g.dx > threshold && panelIndexRef.current === 1) next = 0;
        applyPanel(next);
      },
    })
  ).current;

  // ================= Viewer plein écran =================
  function openFullscreen(idx) {
    setFsIndex(idx);
    fsTrackX.setValue(-idx * width);
    fsOverlayTranslateY.setValue(0);
    fsOverlayOpacity.setValue(1);
    fsOverlayScale.setValue(1);
    setFsOpen(true);
  }
  function closeFsReply() {
    setFsReplyOpen(false);
    setFsReplyText('');
  }
  function closeFullscreen() {
    Animated.parallel([
      Animated.timing(fsOverlayTranslateY, { toValue: 400, duration: 200, useNativeDriver: true }),
      Animated.timing(fsOverlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => {
      setFsOpen(false);
      closeFsReply();
    });
  }
  function openFsReply() {
    if (!todaysPhotosRef.current[fsIndexRef.current]?.ootd) return;
    setFsReplyOpen(true);
    setTimeout(() => fsReplyInputRef.current?.focus(), 250);
  }
  async function sendFsReply() {
    const trimmed = fsReplyText.trim();
    if (!trimmed) return;
    const photo = todaysPhotosRef.current[fsIndexRef.current];
    await insertMessage({ content: trimmed, quotedLabel: `Réponse à la tenue de ${photo?.username || '?'}` });
    closeFsReply();
  }

  const fsAxisRef = useRef(null);
  const fsResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !fsReplyOpenRef.current,
      onMoveShouldSetPanResponder: () => !fsReplyOpenRef.current,
      onPanResponderGrant: () => { fsAxisRef.current = null; },
      onPanResponderMove: (_, g) => {
        if (fsAxisRef.current === null) {
          if (Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8) {
            fsAxisRef.current = Math.abs(g.dx) > Math.abs(g.dy) * 1.15 ? 'x' : 'y';
          }
        }
        if (fsAxisRef.current === 'x') {
          const w = widthRef.current;
          const next = Math.max(Math.min(-fsIndexRef.current * w + g.dx, w * 0.15), -(todaysPhotosRef.current.length - 1) * w - w * 0.15);
          fsTrackX.setValue(next);
        } else if (fsAxisRef.current === 'y') {
          if (g.dy > 0) {
            fsOverlayTranslateY.setValue(Math.min(g.dy * 0.5, 130));
            fsOverlayScale.setValue(1 - Math.min(g.dy, 260) / 1500);
            fsOverlayOpacity.setValue(1 - Math.min(g.dy, 220) / 380);
          } else {
            // Léger cue visuel pour le swipe vers le haut (ouvrir la réponse) —
            // avant ce fix, cette branche n'existait pas du tout : aucun retour
            // visuel pendant le drag, contribuant à l'impression que "rien ne
            // se passe" même une fois le bug de fermeture ci-dessus corrigé.
            fsOverlayTranslateY.setValue(Math.max(g.dy * 0.25, -46));
          }
        }
      },
      onPanResponderRelease: (_, g) => {
        if (fsAxisRef.current === 'x') {
          const w = widthRef.current;
          const threshold = w * 0.18;
          let next = fsIndexRef.current;
          if (g.dx < -threshold && fsIndexRef.current < todaysPhotosRef.current.length - 1) next += 1;
          else if (g.dx > threshold && fsIndexRef.current > 0) next -= 1;
          setFsIndex(next);
          Animated.timing(fsTrackX, { toValue: -next * w, duration: 260, useNativeDriver: true }).start();
        } else if (fsAxisRef.current === 'y') {
          const dy = g.dy;
          Animated.parallel([
            Animated.timing(fsOverlayTranslateY, { toValue: 0, duration: 220, useNativeDriver: true }),
            Animated.timing(fsOverlayOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
            Animated.timing(fsOverlayScale, { toValue: 1, duration: 220, useNativeDriver: true }),
          ]).start();
          if (dy > 70) closeFullscreen();
          else if (dy < -70) openFsReply();
        }
        fsAxisRef.current = null;
      },
    })
  ).current;

  const memberCount = todaysPhotos.length;
  const [fontsLoaded] = useCompetitionFonts();

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={[styles.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <LinearGradient colors={[C.bgGlow, C.bgPage]} style={styles.glow} pointerEvents="none" />

      <View style={styles.header}>
        <View style={styles.headerRow1}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
            <Ionicons name="chevron-back" size={25} color={C.textPri} />
          </TouchableOpacity>
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={1}>{competitionName}</Text>
            {memberCount > 0 && <Text style={styles.subtitle}>{memberCount} membre{memberCount > 1 ? 's' : ''}</Text>}
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={shareInvite}>
            <Ionicons name="add" size={16} color={C.accent} />
            <Text style={styles.addBtnText}>Ajouter</Text>
          </TouchableOpacity>
          <View>
            <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuOpen(v => !v)} hitSlop={8}>
              <Ionicons name="ellipsis-vertical" size={21} color={C.textSub} />
            </TouchableOpacity>
            {menuOpen && (
              <View style={styles.menuPopover}>
                <TouchableOpacity style={styles.menuItem} onPress={leaveCompetition}>
                  <Ionicons name="exit-outline" size={16} color={C.love} />
                  <Text style={styles.menuItemText}>Quitter la compétition</Text>
                </TouchableOpacity>
                {createdBy && userId && createdBy === userId && (
                  <TouchableOpacity style={styles.menuItem} onPress={deleteCompetition}>
                    <Ionicons name="trash-outline" size={16} color={C.love} />
                    <Text style={styles.menuItemText}>Supprimer la compétition</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
        <View style={styles.switcher}>
          <TouchableOpacity style={[styles.switchBtn, panelIndex === 0 && styles.switchBtnActive]} onPress={() => applyPanel(0)}>
            <Text style={[styles.switchBtnText, panelIndex === 0 && styles.switchBtnTextActive]}>Photos & chat</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.switchBtn, panelIndex === 1 && styles.switchBtnActive]} onPress={() => applyPanel(1)}>
            <Text style={[styles.switchBtnText, panelIndex === 1 && styles.switchBtnTextActive]}>Classement</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.viewport} {...pagerResponder.panHandlers}>
        <Animated.View style={[styles.track, { width: width * 2, transform: [{ translateX: pagerX }] }]}>

          {/* PANEL 1 : PHOTOS & CHAT */}
          <KeyboardAvoidingView style={{ width }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              ref={pcScrollRef}
              style={{ flex: 1 }}
              onContentSizeChange={() => pcScrollRef.current?.scrollToEnd({ animated: false })}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.sectionCaption}>Les tenues du jour · touche une photo</Text>
              {todaysLoading ? (
                <ActivityIndicator color={C.accent} style={{ marginVertical: 16 }} />
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbRow}>
                  {todaysPhotos.map((p, i) => (
                    <TouchableOpacity key={p.userId} style={styles.thumb} activeOpacity={0.85} onPress={() => openFullscreen(i)}>
                      {p.ootd ? (
                        <>
                          <ExpoImage source={{ uri: p.ootd.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                          <View style={styles.thumbScore}><Text style={styles.thumbScoreText}>{Math.round(p.ootd.score_global)}</Text></View>
                          <LinearGradient colors={['transparent', 'rgba(5,3,8,0.85)']} style={styles.thumbNameWrap}>
                            <Avatar uri={p.avatarUrl} username={p.username} size={15} borderWidth={0} />
                            <Text style={styles.thumbNameText} numberOfLines={1}>{p.username}</Text>
                          </LinearGradient>
                        </>
                      ) : (
                        <View style={styles.thumbEmpty}>
                          <View style={styles.ghostAvatar}><Text style={styles.ghostAvatarText}>{p.username?.[0]?.toUpperCase() || '?'}</Text></View>
                          <Text style={styles.thumbEmptyText}>{p.username} n'a pas encore posté</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              <Text style={styles.sectionCaption}>Discussion</Text>
              {messagesLoading ? (
                <ActivityIndicator color={C.accent} style={{ marginVertical: 20 }} />
              ) : messages.length === 0 ? (
                <Text style={styles.emptyText}>Aucun message pour l'instant.</Text>
              ) : (
                <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                  {messages.map(m => (
                    <MessageRow
                      key={m.id}
                      message={m}
                      isMine={m.sender_id === userId}
                      quoteText={resolveQuoteText(m)}
                      popoverOpen={activePopoverId === m.id}
                      onTogglePopover={(id) => setActivePopoverId(prev => (prev === id ? null : id))}
                      onSwipeReply={handleSwipeReply}
                      onToggleLike={toggleLike}
                      onPickReaction={pickReaction}
                      onDelete={confirmDelete}
                    />
                  ))}
                </View>
              )}
            </ScrollView>

            <View style={styles.inputArea}>
              {replyTo && (
                <View style={styles.replyBar}>
                  <View style={styles.replyBarAccent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.replyBarLabel}>{replyTo.label}</Text>
                    <Text style={styles.replyBarSnip} numberOfLines={1}>{replyTo.snippet}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={8}>
                    <Ionicons name="close" size={18} color={C.textFaint} />
                  </TouchableOpacity>
                </View>
              )}
              <View style={styles.inputRow}>
                <TouchableOpacity style={styles.inputIconBtn} onPress={pickPhoto} disabled={sending}>
                  <Ionicons name="image-outline" size={20} color={C.accent} />
                </TouchableOpacity>
                <TextInput
                  ref={textInputRef}
                  style={styles.chatField}
                  placeholder="Message..."
                  placeholderTextColor={C.textFaint}
                  value={text}
                  onChangeText={setText}
                  onSubmitEditing={sendText}
                />
                <TouchableOpacity style={styles.sendBtn} onPress={sendText} disabled={!text.trim() || sending}>
                  <Ionicons name="send" size={18} color={C.onAccent} />
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>

          {/* PANEL 2 : CLASSEMENT */}
          <ScrollView style={{ width }} contentContainerStyle={styles.clScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.periodRow}>
              {RANKING_PERIODS.map(p => (
                <TouchableOpacity key={p.key} style={[styles.pill, period === p.key && styles.pillActive]} onPress={() => setPeriod(p.key)}>
                  <Text style={[styles.pillText, period === p.key && styles.pillTextActive]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {rankingLoading ? (
              <ActivityIndicator color={C.accent} style={{ marginTop: 30 }} />
            ) : (
              <>
                <Podium ranking={ranking?.ranking || []} userId={userId} onInvite={shareInvite} />

                <View style={styles.sectionLabelRow}>
                  <Text style={styles.sectionLabel}>Classement complet</Text>
                  <Text style={styles.sectionLabelHint}>
                    {period === 'day' ? 'meilleur score' : 'score moyen'}
                  </Text>
                </View>
                {(ranking?.ranking || []).length === 0 ? (
                  <Text style={styles.emptyText}>Aucun classement pour l'instant.</Text>
                ) : (
                  (ranking?.ranking || []).map((row, i) => (
                    <View key={row.user_id} style={[styles.row, row.user_id === userId && styles.rowMe]}>
                      <Text style={styles.rankNum}>{i + 1}</Text>
                      <Avatar uri={row.avatar_url} username={row.username} size={32} borderWidth={0} />
                      <View style={styles.rowNameWrap}>
                        <Text style={styles.rowName} numberOfLines={1}>{row.username}</Text>
                        {row.user_id === userId && <View style={styles.tag}><Text style={styles.tagText}>Toi</Text></View>}
                      </View>
                      {row.streak_count > 0 && (
                        <View style={styles.streakChip}><Text style={styles.streakChipText}>🔥 {row.streak_count}</Text></View>
                      )}
                      <Text style={row.score != null ? styles.rowScore : styles.rowScoreMuted}>
                        {row.score != null ? Math.round(row.score) : '—'}
                      </Text>
                    </View>
                  ))
                )}

                {(ranking?.most_regular || ranking?.most_liked) && (
                  <View style={styles.chipsRow}>
                    {ranking?.most_regular && (
                      <View style={styles.achip}>
                        <View style={[styles.achipIc, { backgroundColor: 'rgba(255,138,76,0.18)' }]}><Text>🎯</Text></View>
                        <View><Text style={styles.achipTx}>{ranking.most_regular.username}</Text><Text style={styles.achipSub}>Le plus régulier</Text></View>
                      </View>
                    )}
                    {ranking?.most_liked && (
                      <View style={styles.achip}>
                        <View style={[styles.achipIc, { backgroundColor: 'rgba(255,92,122,0.18)' }]}><Text>❤️</Text></View>
                        <View><Text style={styles.achipTx}>{ranking.most_liked.username}</Text><Text style={styles.achipSub}>Coup de cœur</Text></View>
                      </View>
                    )}
                  </View>
                )}
              </>
            )}
          </ScrollView>

        </Animated.View>
      </View>

      {/* VIEWER PLEIN ÉCRAN */}
      {fsOpen && (
        <Animated.View
          style={[
            styles.fsOverlay,
            { opacity: fsOverlayOpacity, transform: [{ translateY: fsOverlayTranslateY }, { scale: fsOverlayScale }] },
          ]}
          {...fsResponder.panHandlers}
        >
          <Animated.View style={[styles.fsTrack, { width: width * todaysPhotos.length, transform: [{ translateX: fsTrackX }] }]}>
            {todaysPhotos.map((p) => (
              <View key={p.userId} style={[styles.fsSlide, { width }]}>
                {p.ootd ? (
                  <>
                    <ExpoImage source={{ uri: p.ootd.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    <View style={styles.fsTop}>
                      <Avatar uri={p.avatarUrl} username={p.username} size={28} borderWidth={0} />
                      <Text style={styles.fsName} numberOfLines={1}>{p.username}</Text>
                      <View style={styles.fsScore}><Text style={styles.fsScoreText}>{Math.round(p.ootd.score_global)}</Text></View>
                      <TouchableOpacity style={styles.fsCloseBtn} onPress={closeFullscreen} hitSlop={8}>
                        <Ionicons name="close" size={15} color="#fff" />
                      </TouchableOpacity>
                    </View>
                    <LinearGradient colors={['transparent', 'rgba(5,3,8,0.9)']} style={styles.fsBottom}>
                      <View style={styles.gaugesRow}>
                        <Gauge label="Fit" value={p.ootd.score_coupe} max={SCORE_MAX.fit} color={C.accent} />
                        <Gauge label="Harmonie" value={p.ootd.score_couleurs} max={SCORE_MAX.harmonie} color={C.violet} />
                        <Gauge label="Détail" value={p.ootd.score_tendance} max={SCORE_MAX.detail} color={C.bronze} />
                      </View>
                      <Text style={styles.fsHint}>Glisse ↑ pour répondre · ↓ pour fermer</Text>
                    </LinearGradient>
                  </>
                ) : (
                  <View style={styles.fsEmpty}>
                    <TouchableOpacity style={[styles.fsCloseBtn, styles.fsCloseBtnAbs]} onPress={closeFullscreen} hitSlop={8}>
                      <Ionicons name="close" size={15} color="#fff" />
                    </TouchableOpacity>
                    <View style={styles.ghostAvatarLg}><Text style={styles.ghostAvatarLgText}>{p.username?.[0]?.toUpperCase() || '?'}</Text></View>
                    <Text style={styles.fsEmptyText}>{p.username} n'a pas encore posté aujourd'hui</Text>
                    <TouchableOpacity style={styles.nudgeBtn} onPress={() => showToast('Fonctionnalité de rappel bientôt disponible', { type: 'info' })}>
                      <Text style={styles.nudgeBtnText}>🔔 Relancer</Text>
                    </TouchableOpacity>
                    <Text style={[styles.fsHint, { position: 'relative', marginTop: 16 }]}>Glisse ↓ pour fermer</Text>
                  </View>
                )}
              </View>
            ))}
          </Animated.View>

          {fsReplyOpen && (
            <View style={styles.fsReply}>
              <TouchableOpacity onPress={closeFsReply} hitSlop={8}>
                <Ionicons name="close" size={18} color={C.textFaint} />
              </TouchableOpacity>
              <TextInput
                ref={fsReplyInputRef}
                style={styles.fsReplyInput}
                placeholder="Répondre à cette tenue..."
                placeholderTextColor={C.textFaint}
                value={fsReplyText}
                onChangeText={setFsReplyText}
                onSubmitEditing={sendFsReply}
              />
              <TouchableOpacity style={styles.fsReplySend} onPress={sendFsReply}>
                <Text style={styles.fsReplySendText}>Envoyer</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      )}

      {(activePopoverId !== null || menuOpen) && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => { setActivePopoverId(null); setMenuOpen(false); }}
        />
      )}
    </SafeAreaView>
  );
}

function Gauge({ label, value, max, color }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.gaugeHeader}>
        <Text style={styles.gaugeLabel}>{label}</Text>
        <Text style={styles.gaugeLabel}>{value != null ? Math.round(value) : '—'}</Text>
      </View>
      <View style={styles.gaugeTrack}>
        <View style={[styles.gaugeFill, { width: `${gaugePct(value, max)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function Podium({ ranking, userId, onInvite }) {
  const top3 = ranking.slice(0, 3);
  const slots = [
    { rank: 2, entry: top3[1], kind: 'silver' },
    { rank: 1, entry: top3[0], kind: 'gold' },
    { rank: 3, entry: top3[2], kind: 'bronze' },
  ];
  return (
    <View style={styles.podium}>
      {slots.map(s => (
        <View key={s.kind} style={styles.podiumSlot}>
          {s.entry ? (
            <>
              <View style={[styles.podiumAvatarWrap, s.kind === 'gold' && styles.podiumAvatarWrapGold, { borderColor: C[s.kind] }]}>
                <Avatar uri={s.entry.avatar_url} username={s.entry.username} size={s.kind === 'gold' ? 64 : 54} borderWidth={0} />
                <View style={[styles.medal, { backgroundColor: C[s.kind] }]}>
                  <Text style={styles.medalText}>{s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : '🥉'}</Text>
                </View>
              </View>
              <Text style={styles.podiumName} numberOfLines={1}>{s.entry.user_id === userId ? 'Toi' : s.entry.username}</Text>
              <Text style={s.entry.score != null ? styles.podiumScore : styles.podiumScoreMuted}>
                {s.entry.score != null ? Math.round(s.entry.score) : '—'}
              </Text>
            </>
          ) : (
            <TouchableOpacity onPress={onInvite} activeOpacity={0.8} style={{ alignItems: 'center' }}>
              <View style={[styles.podiumAvatarWrap, styles.podiumAvatarInvite]}>
                <Ionicons name="add" size={18} color={C.textFaint} />
              </View>
              <Text style={[styles.podiumName, { color: C.textFaint }]}>Inviter</Text>
              <Text style={styles.podiumScoreMuted}> </Text>
            </TouchableOpacity>
          )}
          <View style={[styles.podiumBar, s.kind === 'gold' && styles.podiumBarGold, s.kind === 'silver' && styles.podiumBarSilver, s.kind === 'bronze' && styles.podiumBarBronze]} />
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
const rs = StyleSheet.create({
  row: { position: 'relative', flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginBottom: 10 },
  rowOut: { justifyContent: 'flex-end' },
  replyIcon: { position: 'absolute', left: -22, top: '50%', marginTop: -8 },
  col: { maxWidth: '76%' },
  colOut: { alignItems: 'flex-end' },
  quote: { backgroundColor: C.bgElevated2, borderLeftWidth: 2, borderLeftColor: C.accent, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginBottom: 4 },
  quoteOut: { backgroundColor: 'rgba(0,0,0,0.15)', borderLeftColor: 'rgba(58,15,34,0.4)' },
  quoteText: { fontSize: 12.5, color: C.textSub, fontFamily: FONT_BODY.regular },
  bubble: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 18, position: 'relative' },
  bubbleIn: { backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSoft2, borderBottomLeftRadius: 5 },
  bubbleOut: { backgroundColor: C.accent, borderBottomRightRadius: 5 },
  bubbleText: { fontSize: 15, lineHeight: 21, color: C.textPri },
  bubbleTextIn: { fontFamily: FONT_BODY.regular },
  bubbleTextOut: { fontFamily: FONT_BODY.medium, color: C.onAccent },
  deletedText: { fontSize: 14, fontStyle: 'italic', color: C.textFaint, fontFamily: FONT_BODY.regular },
  bubbleImage: { width: 190, height: 190, borderRadius: 13 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingHorizontal: 4, position: 'relative' },
  metaTime: { fontSize: 11, color: C.textFaint, fontFamily: FONT_BODY.regular },
  heartBurst: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  heartBurstEmoji: { fontSize: 38 },
  reactPopover: { position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 7, zIndex: 5 },
  reactPopoverEmoji: { fontSize: 19 },
  reactPopoverDelete: { marginLeft: 4, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: C.borderSoft2 },
  reactsRow: { flexDirection: 'row', gap: 4, marginTop: 4 },
  reactChip: { backgroundColor: C.bgElevated2, borderWidth: 1, borderColor: C.borderSoft2, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  reactChipLiked: { borderColor: 'rgba(255,92,122,0.5)' },
  reactChipText: { fontSize: 13, color: C.textPri },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bgPage },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 260 },

  // zIndex > 0 : nécessaire pour que le popover du menu "..." (nested ici)
  // et, plus bas, celui des réactions emoji (nested dans viewport) restent
  // au-dessus du Pressable plein écran qui les ferme au tap extérieur — ce
  // dernier est un frère JSX plus tardif, donc dessiné par-dessus par défaut
  // sans cette priorité explicite (reste bien sous fsOverlay, zIndex 50).
  header: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.borderSoft2, zIndex: 2 },
  headerRow1: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  titleBlock: { flex: 1, minWidth: 0 },
  title: { color: C.textPri, fontSize: 19, fontFamily: FONT_DISPLAY },
  subtitle: { color: C.textSub, fontSize: 12.5, fontFamily: FONT_BODY.semibold },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(237,147,177,0.14)', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  addBtnText: { color: C.accent, fontSize: 13.5, fontFamily: FONT_BODY.bold },
  menuBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  menuPopover: {
    position: 'absolute', top: 38, right: 0, minWidth: 220, zIndex: 10,
    backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSoft,
    borderRadius: 14, paddingVertical: 6,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, paddingVertical: 12 },
  menuItemText: { color: C.love, fontSize: 14.5, fontFamily: FONT_BODY.semibold },
  switcher: { flexDirection: 'row', gap: 6 },
  switchBtn: { flex: 1, backgroundColor: C.bgElevated, borderRadius: 13, paddingVertical: 11, alignItems: 'center' },
  switchBtnActive: { backgroundColor: C.accent },
  switchBtnText: { color: C.textSub, fontSize: 14, fontFamily: FONT_BODY.semibold },
  switchBtnTextActive: { color: C.onAccent },

  viewport: { flex: 1, overflow: 'hidden', zIndex: 1 },
  track: { flexDirection: 'row', flex: 1 },

  sectionCaption: { color: C.textFaint, fontSize: 13, marginHorizontal: 16, marginTop: 14, marginBottom: 9, fontFamily: FONT_BODY.semibold },
  emptyText: { color: C.textSub, fontSize: 14, marginHorizontal: 16, marginBottom: 10, fontFamily: FONT_BODY.regular },

  // Carrousel horizontal (2026-09-30) : les vignettes avaient une taille flex
  // divisée par le nombre de membres (minuscules dès 4+ participants) — passe
  // en ScrollView horizontal avec une largeur fixe plus grande, quel que soit
  // le nombre de membres.
  thumbRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
  thumb: { width: 148, aspectRatio: 1 / 1.05, borderRadius: 18, overflow: 'hidden', backgroundColor: '#1a1020' },
  thumbScore: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(10,6,10,0.55)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  thumbScoreText: { color: '#fff', fontSize: 13, fontFamily: FONT_DISPLAY },
  thumbNameWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingTop: 18, paddingBottom: 7 },
  thumbNameText: { color: '#fff', fontSize: 12.5, flexShrink: 1, fontFamily: FONT_BODY.semibold },
  thumbEmpty: { flex: 1, borderWidth: 1.5, borderColor: C.borderSoft, borderStyle: 'dashed', borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 7, padding: 10 },
  ghostAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.bgElevated2, alignItems: 'center', justifyContent: 'center' },
  ghostAvatarText: { color: C.textFaint, fontSize: 14, fontFamily: FONT_DISPLAY },
  thumbEmptyText: { fontSize: 12, color: C.textSub, textAlign: 'center', fontFamily: FONT_BODY.semibold },

  inputArea: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.borderSoft2 },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 8 },
  replyBarAccent: { width: 3, alignSelf: 'stretch', backgroundColor: C.accent, borderRadius: 3, minHeight: 26 },
  replyBarLabel: { fontSize: 11.5, color: C.accent, fontFamily: FONT_BODY.bold },
  replyBarSnip: { fontSize: 12.5, color: C.textSub, fontFamily: FONT_BODY.regular },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  inputIconBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.bgElevated, alignItems: 'center', justifyContent: 'center' },
  chatField: { flex: 1, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSoft2, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 11, fontSize: 14.5, color: C.textPri, fontFamily: FONT_BODY.regular },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },

  clScroll: { padding: 16, paddingBottom: 30 },
  periodRow: { flexDirection: 'row', gap: 6, marginBottom: 18 },
  pill: { flex: 1, borderWidth: 1, borderColor: C.borderSoft, borderRadius: 999, paddingVertical: 8, alignItems: 'center' },
  pillActive: { backgroundColor: C.accent, borderColor: 'transparent' },
  pillText: { color: C.textSub, fontSize: 11.5, fontFamily: FONT_BODY.semibold },
  pillTextActive: { color: C.onAccent },

  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 22 },
  podiumSlot: { flex: 1, alignItems: 'center' },
  podiumAvatarWrap: { width: 54, height: 54, borderRadius: 27, borderWidth: 2.5, borderColor: C.bgBase, marginBottom: 8, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  podiumAvatarWrapGold: { width: 64, height: 64, borderRadius: 32 },
  podiumAvatarInvite: { borderStyle: 'dashed', borderWidth: 1.5, borderColor: C.borderSoft, backgroundColor: C.bgElevated2 },
  medal: { position: 'absolute', bottom: -4, right: -4, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.bgBase },
  medalText: { fontSize: 10 },
  podiumName: { fontSize: 12.5, color: C.textPri, textAlign: 'center', fontFamily: FONT_BODY.semibold },
  podiumScore: { marginTop: 5, fontSize: 13, paddingHorizontal: 10, paddingVertical: 2, borderRadius: 999, backgroundColor: C.bgElevated2, color: C.accent, fontFamily: FONT_DISPLAY },
  podiumScoreMuted: { marginTop: 5, fontSize: 13, color: C.textFaint, fontFamily: FONT_DISPLAY },
  podiumBar: { width: '100%', borderTopLeftRadius: 10, borderTopRightRadius: 10, marginTop: 10 },
  podiumBarGold: { height: 46, backgroundColor: C.accent },
  podiumBarSilver: { height: 32, backgroundColor: C.bgElevated2, borderWidth: 1, borderColor: C.borderSoft },
  podiumBarBronze: { height: 22, borderWidth: 1.5, borderColor: C.borderSoft, borderStyle: 'dashed' },

  sectionLabelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, marginTop: 4 },
  sectionLabel: { fontSize: 12, color: C.textFaint, fontFamily: FONT_BODY.semibold },
  sectionLabelHint: { fontSize: 11, color: C.textFaint, fontFamily: FONT_BODY.regular, fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSoft2, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 7 },
  rowMe: { borderColor: C.accent, backgroundColor: 'rgba(237,147,177,0.08)' },
  rankNum: { width: 16, textAlign: 'center', fontSize: 12, color: C.textFaint, fontFamily: FONT_DISPLAY },
  rowNameWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  rowName: { fontSize: 13, color: C.textPri, flexShrink: 1, fontFamily: FONT_BODY.semibold },
  tag: { backgroundColor: 'rgba(237,147,177,0.14)', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  tagText: { fontSize: 9.5, color: C.accent, fontFamily: FONT_BODY.bold },
  streakChip: { backgroundColor: 'rgba(255,138,76,0.15)', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  streakChipText: { fontSize: 10.5, color: C.streak, fontFamily: FONT_BODY.bold },
  rowScore: { fontSize: 14, color: C.textPri, fontFamily: FONT_DISPLAY },
  rowScoreMuted: { fontSize: 12, color: C.textFaint, fontFamily: FONT_BODY.semibold },

  chipsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  achip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSoft2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  achipIc: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  achipTx: { fontSize: 10.5, color: C.textPri, fontFamily: FONT_BODY.semibold },
  achipSub: { fontSize: 8.5, color: C.textSub, fontFamily: FONT_BODY.semibold },

  fsOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bgBase, zIndex: 50 },
  fsTrack: { flexDirection: 'row', flex: 1 },
  fsSlide: { height: '100%', position: 'relative' },
  fsTop: { position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 2 },
  fsName: { flex: 1, fontSize: 13, color: '#fff', fontFamily: FONT_BODY.semibold },
  fsScore: { backgroundColor: 'rgba(10,6,10,0.55)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 3 },
  fsScoreText: { color: '#fff', fontSize: 14, fontFamily: FONT_DISPLAY },
  fsCloseBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(10,6,10,0.45)', alignItems: 'center', justifyContent: 'center' },
  fsCloseBtnAbs: { position: 'absolute', top: 14, right: 14, zIndex: 2 },
  fsBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 34, paddingBottom: 16 },
  gaugesRow: { flexDirection: 'row', gap: 8 },
  gaugeHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  gaugeLabel: { fontSize: 9.5, color: 'rgba(246,238,242,0.65)', fontFamily: FONT_BODY.semibold },
  gaugeTrack: { height: 3.5, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  gaugeFill: { height: '100%', borderRadius: 99 },
  fsHint: { textAlign: 'center', fontSize: 11, color: 'rgba(246,238,242,0.55)', marginTop: 10, fontFamily: FONT_BODY.semibold },
  fsEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 30 },
  ghostAvatarLg: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.bgElevated2, alignItems: 'center', justifyContent: 'center' },
  ghostAvatarLgText: { color: C.textFaint, fontSize: 18, fontFamily: FONT_DISPLAY },
  fsEmptyText: { fontSize: 13, color: C.textSub, textAlign: 'center', fontFamily: FONT_BODY.semibold },
  nudgeBtn: { borderWidth: 1, borderColor: C.borderSoft, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  nudgeBtnText: { color: C.accent, fontSize: 11.5, fontFamily: FONT_BODY.bold },
  fsReply: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.bgElevated, borderTopWidth: 1, borderTopColor: C.borderSoft, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 3 },
  fsReplyInput: { flex: 1, backgroundColor: C.bgElevated2, borderWidth: 1, borderColor: C.borderSoft2, borderRadius: 999, paddingHorizontal: 15, paddingVertical: 10, fontSize: 13, color: C.textPri, fontFamily: FONT_BODY.regular },
  fsReplySend: { backgroundColor: C.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  fsReplySendText: { color: C.onAccent, fontSize: 12.5, fontFamily: FONT_BODY.bold },
});
