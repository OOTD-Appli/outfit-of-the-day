import { useState, useCallback, useRef, memo, useEffect } from 'react';
import {
  View, Text, StyleSheet, Animated,
  TouchableOpacity, ActivityIndicator,
  RefreshControl, Modal, FlatList, useWindowDimensions,
} from 'react-native';
import ReAnimated, {
  useSharedValue, useAnimatedStyle,
  withSpring, withTiming, withDelay, Easing as ReEasing,
} from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { Audio } from 'expo-av';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import FeedCommentsModal from '../components/FeedCommentsModal';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';
import { getLogoConfig } from '../lib/logoConfig';
import { timeAgo } from '../lib/utils';
import { triggerHaptic } from '../lib/haptics';
import Bouncy from '../components/Bouncy';
import Skeleton from '../components/Skeleton';

// Pré-charge en arrière-plan les images des prochains posts + avatars (cache expo-image).
function prefetchUpcoming(list, startIndex, count = 3) {
  const urls = [];
  for (let i = startIndex; i < Math.min(startIndex + count, list.length); i++) {
    if (list[i]?.image_url) urls.push(list[i].image_url);
    if (list[i]?.profiles?.avatar_url) urls.push(list[i].profiles.avatar_url);
    if (list[i]?.audio_cover_url) urls.push(list[i].audio_cover_url);
  }
  if (urls.length) ExpoImage.prefetch(urls).catch(() => {});
}

function feedCommentCount(item) {
  const c = item?.comments;
  if (!Array.isArray(c) || c.length === 0) return 0;
  const n = c[0]?.count;
  return typeof n === 'number' ? n : 0;
}

function formatCount(n) {
  if (!n) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')} k`;
  return String(n);
}

/* ── FeedPost — memo évite le re-render quand les autres posts changent ── */
const FeedPost = memo(function FeedPost({ item, userId, pageH, ww, insets, theme, onToggleLike, onOpenComments, onOpenShare, onAddFriend, isCurrentlyPlaying, isMuted }) {
  const likeObj = item.likes?.find(l => l.user_id === userId);
  const isLiked = !!likeObj;
  const likesCount = item.likes?.length || 0;
  const commentsCount = feedCommentCount(item);
  const logoConfig = getLogoConfig(item.profiles?.active_logo);
  const frameColor = logoConfig.frameBorderColor || theme.accent;
  const avatarInitial = item.profiles?.username?.[0]?.toUpperCase() || '?';

  const heartScale = useRef(new Animated.Value(1)).current;

  // Overlay cœur double-tap — thread UI via Reanimated 3 worklets
  const overlayScale = useSharedValue(0.3);
  const overlayOpacity = useSharedValue(0);
  const overlayRotate = useSharedValue(0);

  const overlayWrapStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));
  const overlayIconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: overlayScale.value },
      { rotate: `${overlayRotate.value * -12 + 12}deg` }, // 0→'-12deg', 1→'0deg'
    ],
  }));

  const lastTapRef = useRef(0);
  const touchStartY = useRef(0);

  const handleLike = () => {
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.35, useNativeDriver: true, speed: 35, bounciness: 12 }),
      Animated.spring(heartScale, { toValue: 1.0,  useNativeDriver: true, speed: 20, bounciness: 8  }),
    ]).start();
    onToggleLike(item.id, isLiked, likeObj?.id);
  };

  const playOverlayHeart = () => {
    // Anti-pattern évité : on ne part PAS de scale 0. Pop élastique (overshoot),
    // léger redressement (rotation), puis sortie rapide (timing asymétrique).
    overlayScale.value = 0.3;
    overlayRotate.value = 0;
    overlayOpacity.value = 1;
    overlayScale.value = withSpring(1.0, { speed: 16, bounciness: 16 });
    overlayRotate.value = withTiming(1, { duration: 200, easing: ReEasing.out(ReEasing.cubic) });
    overlayOpacity.value = withDelay(280, withTiming(0, { duration: 200 }));
  };

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      playOverlayHeart();
      triggerHaptic(12); // micro-vibration PWA-safe au pop du cœur
      if (!isLiked) onToggleLike(item.id, false, null);
    } else {
      lastTapRef.current = now;
    }
  };

  const infoPadBottom = Math.max(insets.bottom + 18, 24);
  const actionsBottom = infoPadBottom + 120;

  return (
    <View style={{ width: ww, height: pageH, backgroundColor: '#0a0a0a' }}>
      {/* Photo plein écran */}
      <ExpoImage
        source={{ uri: item.image_url }}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        transition={200}
        recyclingKey={item.id}
      />

      {/* Dégradé bas + infos utilisateur */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.72)']}
        locations={[0.38, 0.62, 1]}
        style={[styles.postGradient, { paddingBottom: infoPadBottom }]}
      >
        {/* Badge OOTD */}
        <View style={styles.ootdBadge}>
          <Text style={styles.ootdBadgeText}>OOTD</Text>
        </View>

        {/* Username + vérif + badge logo */}
        <View style={styles.usernameRow}>
          <Text style={styles.postUsername}>@{item.profiles?.username || 'anonyme'}</Text>
          <Feather name="check-circle" size={13} color="rgba(255,255,255,0.88)" />
          {logoConfig.badge ? <Text style={styles.logoBadge}>{logoConfig.badge}</Text> : null}
        </View>

        {/* Caption */}
        {item.caption ? (
          <Text style={styles.postCaption} numberOfLines={2}>{item.caption}</Text>
        ) : null}

        {/* Barre musique */}
        <View style={styles.musicRow}>
          {item.audio_preview_url ? (
            <>
              {item.audio_cover_url
                ? <ExpoImage source={{ uri: item.audio_cover_url }} style={styles.musicCoverThumb} contentFit="cover" />
                : <Feather name="music" size={11} color="rgba(255,255,255,0.72)" />}
              <Text style={styles.musicText} numberOfLines={1}>
                {isCurrentlyPlaying
                  ? (isMuted ? '🔇 ' : '♪ ')
                  : '♪ '}
                {item.audio_title} — {item.audio_artist}
              </Text>
            </>
          ) : (
            <>
              <Feather name="music" size={11} color="rgba(255,255,255,0.72)" />
              <Text style={styles.musicText} numberOfLines={1}> Original Sound</Text>
            </>
          )}
        </View>
      </LinearGradient>

      {/* Zone double-tap — View passif (pas de preventDefault → scroll non bloqué) */}
      <View
        style={StyleSheet.absoluteFillObject}
        onTouchStart={e => { touchStartY.current = e.nativeEvent.pageY; }}
        onTouchEnd={e => {
          if (Math.abs(e.nativeEvent.pageY - touchStartY.current) > 8) return;
          handleDoubleTap();
        }}
      />

      {/* Overlay cœur feedback double-tap */}
      <ReAnimated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, styles.heartOverlayWrap, overlayWrapStyle]}
      >
        <ReAnimated.Text style={[styles.heartOverlayIcon, overlayIconStyle]}>
          ❤️
        </ReAnimated.Text>
      </ReAnimated.View>

      {/* Logo badge */}
      {logoConfig.postIcon ? (
        <View style={[styles.postLogoBadge, { top: Math.max(insets.top + 62, 80) }]}>
          <Text style={styles.postLogoIcon}>{logoConfig.postIcon}</Text>
        </View>
      ) : null}

      {/* Actions latérales droite */}
      <View style={[styles.sideCol, { bottom: actionsBottom }]}>
        {/* Avatar auteur + bouton + */}
        <TouchableOpacity onPress={() => onAddFriend(item.user_id)} activeOpacity={0.82}>
          <View style={styles.sideAvatarWrap}>
            <LinearGradient
              colors={[frameColor, '#FF4567']}
              start={{ x: 0, y: 1 }}
              end={{ x: 1, y: 0 }}
              style={styles.avatarGradientRing}
            >
              <View style={styles.avatarInner}>
                {item.profiles?.avatar_url ? (
                  <ExpoImage
                    source={{ uri: item.profiles.avatar_url }}
                    style={styles.sideAvatar}
                    contentFit="cover"
                    recyclingKey={item.profiles.avatar_url}
                  />
                ) : (
                  <View style={[styles.sideAvatarFallback, { backgroundColor: frameColor + 'CC' }]}>
                    <Text style={styles.sideAvatarInitial}>{avatarInitial}</Text>
                  </View>
                )}
              </View>
            </LinearGradient>
            <View style={[styles.addBadge, { backgroundColor: theme.accent }]}>
              <Feather name="plus" size={11} color="#fff" />
            </View>
          </View>
        </TouchableOpacity>

        {/* Like */}
        <TouchableOpacity onPress={handleLike} activeOpacity={0.82}>
          <Animated.View style={[styles.sideAction, { transform: [{ scale: heartScale }] }]}>
            <Feather name="heart" size={30} color={isLiked ? '#FF4567' : '#fff'} />
            <Text style={styles.sideCount}>{formatCount(likesCount)}</Text>
          </Animated.View>
        </TouchableOpacity>

        {/* Commentaires */}
        <Bouncy style={styles.sideAction} onPress={() => onOpenComments(item.id)}>
          <Feather name="message-circle" size={30} color="#fff" />
          <Text style={styles.sideCount}>{formatCount(commentsCount)}</Text>
        </Bouncy>

        {/* Partager */}
        <Bouncy style={styles.sideAction} onPress={() => onOpenShare(item)}>
          <Feather name="send" size={28} color="#fff" />
          <Text style={styles.sideCount}> </Text>
        </Bouncy>

        {/* Plus */}
        <Bouncy style={styles.sideAction}>
          <Feather name="more-horizontal" size={26} color="#fff" />
        </Bouncy>
      </View>
    </View>
  );
});

/* ── FeedScreen ── */
export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const { width: ww } = useWindowDimensions();
  const [pageH, setPageH] = useState(0);

  const PAGE_SIZE = 10;
  const [feedTab, setFeedTab] = useState('pourtoi');
  const [ootds, setOotds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [userId, setUserId] = useState(null);
  const [commentOotdId, setCommentOotdId] = useState(null);
  const [shareChatModal, setShareChatModal] = useState({ visible: false, item: null });
  const [chatFriends, setChatFriends] = useState([]);
  const feedFirstFocus = useRef(true);
  const ootdsRef = useRef([]);
  const pageRef = useRef(0);
  const friendIdsRef = useRef([]);
  const userIdRef = useRef(null);
  const [isMuted, setIsMuted] = useState(false);
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState(null);
  const soundRef = useRef(null);
  const isMutedRef = useRef(false);
  // audioActiveRef = true uniquement quand le Feed est au premier plan.
  // Évite la race condition où createAsync se termine après un changement
  // d'onglet (le son s'assigne après la cleanup et joue en arrière-plan).
  const audioActiveRef = useRef(false);

  // Init mode audio une fois
  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: false }).catch(() => {});
    return () => {
      audioActiveRef.current = false;
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  const stopCurrentSound = useCallback(async () => {
    const s = soundRef.current;
    soundRef.current = null;
    if (s) { try { await s.stopAsync(); await s.unloadAsync(); } catch (_) {} }
  }, []);

  const playAudio = useCallback(async (previewUrl) => {
    await stopCurrentSound();
    if (!previewUrl || !audioActiveRef.current) return;
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: previewUrl },
        { shouldPlay: !isMutedRef.current, isLooping: true, volume: 1.0 },
      );
      // Vérification post-async : l'onglet a pu perdre le focus pendant le chargement
      if (!audioActiveRef.current) { sound.unloadAsync().catch(() => {}); return; }
      soundRef.current = sound;
    } catch (_) {}
  }, [stopCurrentSound]);

  const toggleMute = useCallback(async () => {
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);
    if (soundRef.current) {
      try { await soundRef.current.setIsMutedAsync(next); } catch (_) {}
    }
  }, []);

  // Viewability : item visible à ≥80% → lance l'audio associé
  const currentlyVisibleItemRef = useRef(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }) => {
    const visible = viewableItems[0]?.item ?? null;
    currentlyVisibleItemRef.current = visible;
    setCurrentlyPlayingId(visible?.id ?? null);
    playAudio(visible?.audio_preview_url ?? null);
  }).current;
  const { showToast } = useToast();
  const { theme } = useTheme();

  const handleThreadCount = useCallback((ootdId, count) => {
    setOotds(prev => prev.map(o => o.id !== ootdId ? o : { ...o, comments: [{ count }] }));
  }, []);

  const fetchFeed = useCallback(async (opts = {}) => {
    const { soft = false, silent = false } = opts;
    if (!silent) {
      if (soft) setRefreshing(true);
      else setLoading(true);
      setFetchError(null);
    }
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user?.id);
    userIdRef.current = user?.id;

    // Récupère les amis pour le filtre confidentialité
    if (user) {
      const [{ data: fd1 }, { data: fd2 }] = await Promise.all([
        supabase.from('friendships').select('friend_id').eq('user_id', user.id).eq('status', 'accepted'),
        supabase.from('friendships').select('user_id').eq('friend_id', user.id).eq('status', 'accepted'),
      ]);
      friendIdsRef.current = [...new Set([...(fd1 || []).map(r => r.friend_id), ...(fd2 || []).map(r => r.user_id)])];
    }

    const { data, error } = await supabase
      .from('ootds')
      .select(`id, user_id, image_url, caption, audio_title, audio_artist, audio_preview_url, audio_cover_url, created_at, profiles(username, avatar_url, active_logo, is_private), likes(id, user_id), comments(count)`)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .range(0, PAGE_SIZE - 1);
    if (error) {
      if (!silent) setFetchError(error.message || 'Impossible de charger le feed.');
    } else {
      const list = (data ?? []).filter(item =>
        !item.profiles?.is_private || item.user_id === user?.id || friendIdsRef.current.includes(item.user_id),
      );
      ootdsRef.current = list;
      setOotds(list);
      setFetchError(null);
      setHasMore((data ?? []).length === PAGE_SIZE);
      pageRef.current = 1;
      prefetchUpcoming(list, 1, 3); // précharge les 3 prochains posts + avatars
    }
    if (!silent) { setLoading(false); setRefreshing(false); }
  }, []);

  const loadMoreFeed = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const start = pageRef.current * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('ootds')
      .select(`id, user_id, image_url, caption, audio_title, audio_artist, audio_preview_url, audio_cover_url, created_at, profiles(username, avatar_url, active_logo, is_private), likes(id, user_id), comments(count)`)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .range(start, end);
    if (!error && data) {
      const list = (data ?? []).filter(item =>
        !item.profiles?.is_private || item.user_id === userIdRef.current || friendIdsRef.current.includes(item.user_id),
      );
      setOotds(prev => {
        const next = [...prev, ...list];
        ootdsRef.current = next;
        prefetchUpcoming(next, prev.length, 3); // précharge le premier lot fraîchement ajouté
        return next;
      });
      setHasMore((data ?? []).length === PAGE_SIZE);
      pageRef.current += 1;
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore]);

  useFocusEffect(
    useCallback(() => {
      audioActiveRef.current = true;
      if (feedFirstFocus.current) { feedFirstFocus.current = false; fetchFeed(); }
      else { fetchFeed({ silent: true }); }
      // Reprend l'audio du post visible au retour sur l'onglet
      const item = currentlyVisibleItemRef.current;
      if (item?.audio_preview_url) playAudio(item.audio_preview_url);
      // Arrête l'audio dès que l'onglet perd le focus
      return () => {
        audioActiveRef.current = false;
        stopCurrentSound();
      };
    }, [fetchFeed, playAudio, stopCurrentSound]),
  );

  const loadChatFriends = useCallback(async () => {
    if (!userId) return;
    const [{ data: fd1 }, { data: fd2 }] = await Promise.all([
      supabase.from('friendships').select('friend_id').eq('user_id', userId).eq('status', 'accepted'),
      supabase.from('friendships').select('user_id').eq('friend_id', userId).eq('status', 'accepted'),
    ]);
    const ids = [...new Set([...(fd1 || []).map(r => r.friend_id), ...(fd2 || []).map(r => r.user_id)])];
    if (ids.length) {
      const { data } = await supabase.from('profiles').select('id, username, avatar_url').in('id', ids);
      setChatFriends(data || []);
    } else {
      setChatFriends([]);
    }
  }, [userId]);

  const addFriend = useCallback(async (authorId) => {
    if (!authorId || authorId === userId) return;
    try {
      const { error } = await supabase.from('friendships').insert({ user_id: userId, friend_id: authorId, status: 'pending' });
      if (error && error.code !== '23505') throw error;
      showToast('Demande d\'ami envoyée !', { type: 'success' });
    } catch (e) {
      showToast(e?.message || 'Erreur', { type: 'error' });
    }
  }, [userId, showToast]);

  const openShareModal = useCallback((item) => {
    setShareChatModal({ visible: true, item });
    loadChatFriends();
  }, [loadChatFriends]);

  const shareToFriend = async (friend) => {
    const post = shareChatModal.item;
    if (!post || !friend) return;
    try {
      const { error } = await supabase.from('messages').insert({
        sender_id: userId,
        receiver_id: friend.id,
        image_url: post.image_url,
        content: `${post.profiles?.username || 'Quelqu\'un'} a partagé une tenue`,
      });
      if (error) throw error;
      showToast(`Envoyé à ${friend.username} !`, { type: 'success' });
      setShareChatModal({ visible: false, item: null });
    } catch (e) {
      showToast(e?.message || 'Erreur d\'envoi', { type: 'error' });
    }
  };

  const toggleLike = useCallback(async (ootdId, isLiked, likeId) => {
    const prevSnap = ootdsRef.current;
    setOotds(curr => {
      const next = curr.map(item => {
        if (item.id !== ootdId) return item;
        if (isLiked) return { ...item, likes: (item.likes || []).filter(l => l.id !== likeId) };
        return { ...item, likes: [...(item.likes || []), { id: 'temp', user_id: userId }] };
      });
      ootdsRef.current = next;
      return next;
    });
    try {
      if (isLiked) {
        const { error } = await supabase.from('likes').delete().eq('id', likeId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('likes').insert({ user_id: userId, ootd_id: ootdId }).select().single();
        if (error) throw error;
        if (data) {
          setOotds(curr => {
            const next = curr.map(item =>
              item.id !== ootdId ? item : {
                ...item,
                likes: (item.likes || []).map(l => l.id === 'temp' ? data : l),
              },
            );
            ootdsRef.current = next;
            return next;
          });
        }
      }
    } catch (e) {
      ootdsRef.current = prevSnap;
      setOotds(prevSnap);
      showToast(e?.message || 'Une erreur est survenue.', { type: 'error' });
    }
  }, [userId, showToast]);

  const renderItem = useCallback(({ item }) => (
    <FeedPost
      item={item}
      userId={userId}
      pageH={pageH}
      ww={ww}
      insets={insets}
      theme={theme}
      onToggleLike={toggleLike}
      onOpenComments={setCommentOotdId}
      onOpenShare={openShareModal}
      onAddFriend={addFriend}
      isCurrentlyPlaying={item.id === currentlyPlayingId}
      isMuted={isMuted}
    />
  ), [userId, pageH, ww, insets, theme, toggleLike, openShareModal, addFriend, currentlyPlayingId, isMuted]);

  const tabTop = Math.max(insets.top, 44);

  return (
    <View
      style={styles.container}
      onLayout={e => { const h = Math.round(e.nativeEvent.layout.height); if (h > 0) setPageH(h); }}
    >
      <FeedCommentsModal
        visible={!!commentOotdId}
        ootdId={commentOotdId}
        userId={userId}
        onClose={() => setCommentOotdId(null)}
        onThreadCount={handleThreadCount}
      />

      {/* Modal partage chat */}
      <Modal
        visible={shareChatModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setShareChatModal({ visible: false, item: null })}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: theme.card }]}>
            <View style={[styles.modalHandle, { backgroundColor: theme.border }]} />
            <Text style={[styles.modalTitle, { color: theme.textPri }]}>Envoyer dans le Chat</Text>
            {chatFriends.length === 0 ? (
              <Text style={[styles.modalEmpty, { color: theme.textSub }]}>Aucun ami pour l'instant</Text>
            ) : (
              <FlatList
                data={chatFriends}
                keyExtractor={f => f.id}
                renderItem={({ item: friend }) => (
                  <TouchableOpacity
                    style={[styles.modalFriendRow, { borderBottomColor: theme.border }]}
                    onPress={() => shareToFriend(friend)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.modalAvatarWrap, { backgroundColor: theme.accent + 'BB' }]}>
                      {friend.avatar_url ? (
                        <ExpoImage source={{ uri: friend.avatar_url }} style={styles.modalAvatarImg} contentFit="cover" />
                      ) : (
                        <Text style={styles.modalAvatarText}>{friend.username?.[0]?.toUpperCase()}</Text>
                      )}
                    </View>
                    <Text style={[styles.modalFriendName, { color: theme.textPri }]}>{friend.username}</Text>
                    <Text style={[styles.modalSendLabel, { color: theme.accent }]}>Envoyer</Text>
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity
              style={[styles.modalCancelBtn, { backgroundColor: theme.border }]}
              onPress={() => setShareChatModal({ visible: false, item: null })}
            >
              <Text style={[styles.modalCancelText, { color: theme.textPri }]}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Barre supérieure — glassmorphism */}
      <View style={styles.topBar} pointerEvents="box-none">
        <BlurView intensity={28} tint="dark" style={{ backgroundColor: 'rgba(0,0,0,0.15)', overflow: 'hidden' }}>
          <View style={[styles.topBarRow, { paddingTop: tabTop }]}>
            <TouchableOpacity onPress={() => setFeedTab('ootd')} style={styles.tabBtn}>
              <Text style={[styles.tabText, feedTab === 'ootd' && styles.tabTextActive, feedTab === 'ootd' && { color: theme.accent }]}>OOTD</Text>
              {feedTab === 'ootd' && <View style={[styles.tabUnderline, { backgroundColor: theme.accent }]} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setFeedTab('pourtoi')} style={styles.tabBtn}>
              <Text style={[styles.tabText, feedTab === 'pourtoi' && styles.tabTextActive, feedTab === 'pourtoi' && { color: theme.accent }]}>POUR TOI</Text>
              {feedTab === 'pourtoi' && <View style={[styles.tabUnderline, { backgroundColor: theme.accent }]} />}
            </TouchableOpacity>
            <TouchableOpacity style={styles.searchBtn}>
              <Feather name="search" size={20} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.muteBtn} onPress={toggleMute}>
              <Feather name={isMuted ? 'volume-x' : 'volume-2'} size={20} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
          </View>
        </BlurView>
      </View>

      {/* Feed */}
      {(loading || pageH === 0) ? (
        <View style={[styles.center, { justifyContent: 'flex-end', paddingBottom: insets.bottom + 110, paddingHorizontal: 16 }]}>
          {/* Skeleton feed (sombre) — épouse la forme d'un post */}
          <View style={{ position: 'absolute', right: 12, bottom: insets.bottom + 150, gap: 22, alignItems: 'center' }}>
            {[52, 30, 30, 28].map((sz, i) => (
              <Skeleton key={i} width={sz} height={sz} borderRadius={sz / 2} color="#2c2c2c" />
            ))}
          </View>
          <Skeleton width={70} height={22} borderRadius={11} color="#2c2c2c" style={{ marginBottom: 10 }} />
          <Skeleton width={170} height={16} borderRadius={6} color="#2c2c2c" style={{ marginBottom: 8 }} />
          <Skeleton width="62%" height={13} borderRadius={6} color="#2c2c2c" style={{ marginBottom: 8 }} />
          <Skeleton width={130} height={12} borderRadius={6} color="#2c2c2c" />
        </View>
      ) : (
        <FlatList
          data={ootds}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          pagingEnabled
          decelerationRate="fast"
          bounces={false}
          nestedScrollEnabled={false}
          overScrollMode="never"
          windowSize={3}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          updateCellsBatchingPeriod={50}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={onViewableItemsChanged}
          getItemLayout={(_, index) => ({ length: pageH, offset: pageH * index, index })}
          onEndReached={loadMoreFeed}
          onEndReachedThreshold={1.5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchFeed({ soft: true })}
              tintColor={theme.accent}
              colors={[theme.accent]}
            />
          }
          ListFooterComponent={
            loadingMore
              ? <View style={{ padding: 24, alignItems: 'center', backgroundColor: '#0a0a0a' }}><ActivityIndicator color={theme.accent} /></View>
              : null
          }
          ListEmptyComponent={
            <View style={[styles.empty, { minHeight: pageH - 100 }]}>
              {fetchError ? (
                <>
                  <Feather name="wifi-off" size={40} color="#555" />
                  <Text style={styles.emptyText}>Pas de connexion au feed</Text>
                  <Text style={styles.emptySub}>{fetchError}</Text>
                  <TouchableOpacity style={[styles.retryBtn, { backgroundColor: theme.accent }]} onPress={() => fetchFeed()}>
                    <Text style={styles.retryBtnText}>Réessayer</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Feather name="camera" size={40} color="#555" />
                  <Text style={styles.emptyText}>Aucune tenue pour l'instant</Text>
                  <Text style={styles.emptySub}>Poste depuis l'onglet Analyse.</Text>
                </>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },

  /* FeedPost */
  postGradient: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  ootdBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(237,147,177,0.35)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(237,147,177,0.5)',
  },
  ootdBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  usernameRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  postUsername: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  logoBadge: { fontSize: 13 },
  postCaption: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 13.5,
    lineHeight: 19,
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  musicRow:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  musicText:        { color: 'rgba(255,255,255,0.72)', fontSize: 11.5, fontStyle: 'italic', flex: 1 },
  musicCoverThumb:  { width: 20, height: 20, borderRadius: 4 },
  muteBtn:          { position: 'absolute', left: 16, bottom: 12 },

  postLogoBadge: {
    position: 'absolute',
    right: 72,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  postLogoIcon: { fontSize: 16 },

  /* Overlay cœur double-tap */
  heartOverlayWrap: { alignItems: 'center', justifyContent: 'center' },
  heartOverlayIcon: { fontSize: 96 },

  /* Actions droite */
  sideCol: { position: 'absolute', right: 12, alignItems: 'center', gap: 24 },
  sideAvatarWrap: { position: 'relative', alignItems: 'center' },
  avatarGradientRing: { borderRadius: 32, padding: 2.5 },
  avatarInner: { borderRadius: 30, overflow: 'hidden', width: 52, height: 52, backgroundColor: '#0a0a0a' },
  sideAvatar: { width: 52, height: 52, borderRadius: 0 },
  sideAvatarFallback: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  sideAvatarInitial: { color: '#fff', fontWeight: '700', fontSize: 19 },
  addBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 21,
    height: 21,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0a0a0a',
  },
  sideAction: { alignItems: 'center', gap: 4 },
  sideCount: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  /* Barre supérieure */
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 12,
    paddingHorizontal: 16,
    gap: 24,
  },
  tabBtn: { alignItems: 'center' },
  tabText: { color: 'rgba(255,255,255,0.5)', fontSize: 15, fontWeight: '600' },
  tabTextActive: { color: '#fff', fontWeight: '800' },
  tabUnderline: { height: 2.5, width: '100%', borderRadius: 2, marginTop: 4 },
  searchBtn: { position: 'absolute', right: 16, bottom: 12 },

  /* Empty */
  empty: { alignItems: 'center', justifyContent: 'center', flexGrow: 1, backgroundColor: '#0a0a0a', gap: 12 },
  emptyText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  emptySub: { color: '#555', fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
  retryBtn: { marginTop: 6, paddingHorizontal: 26, paddingVertical: 12, borderRadius: 22 },
  retryBtnText: { color: '#1a0a10', fontWeight: '700', fontSize: 14 },

  /* Modal partage */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingTop: 12, maxHeight: '65%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  modalEmpty: { textAlign: 'center', marginVertical: 20, fontSize: 14 },
  modalFriendRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  modalAvatarWrap: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  modalAvatarImg: { width: 44, height: 44, borderRadius: 22 },
  modalAvatarText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  modalFriendName: { flex: 1, fontWeight: '600', fontSize: 15 },
  modalSendLabel: { fontSize: 13, fontWeight: '700' },
  modalCancelBtn: { marginTop: 16, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  modalCancelText: { fontWeight: '600', fontSize: 15 },
});
