import { useState, useCallback, useRef, useEffect, useMemo, memo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet, Animated, Easing,
  FlatList, TouchableOpacity, ActivityIndicator,
  TextInput, ScrollView, Alert, KeyboardAvoidingView, Platform, Modal,
  useWindowDimensions, PanResponder,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Video, ResizeMode, Audio } from 'expo-av';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import { flammeOrderedIds } from '../lib/flammesUtils';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';
import { getLogoConfig } from '../lib/logoConfig';
import { setActiveChat } from '../lib/activeChat';
import { dismissChatNotifications } from '../lib/webPush';
import { triggerHaptic } from '../lib/haptics';
import Bouncy from '../components/Bouncy';
import AnimatedEntrance from '../components/AnimatedEntrance';
import InAppCamera from '../components/InAppCamera';

// DB : score_couleurs=harmonie, score_coupe=fit, score_tendance=détails.
const SNAP_NOTES = [
  { key: 'score_coupe',    label: 'Fit' },
  { key: 'score_couleurs', label: 'Harmonie' },
  { key: 'score_tendance', label: 'Détails' },
];

function fmtSnapNote(value) {
  if (typeof value !== 'number') return '–';
  return Number.isInteger(value) ? `${value}` : value.toFixed(1).replace('.', ',');
}

function AudioMessage({ url, isPlaying, onPlay, theme, duration }) {
  const bars = [3, 6, 10, 7, 12, 8, 4, 9, 5, 11, 7, 9];
  const fmtDur = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  return (
    <TouchableOpacity style={styles.audioMsgRow} onPress={onPlay} activeOpacity={0.75}>
      <View style={[styles.audioPlayCircle, { backgroundColor: theme.accent + '33' }]}>
        <Feather name={isPlaying ? 'pause' : 'play'} size={14} color={theme.accent} />
      </View>
      <View style={styles.audioWaveform}>
        {bars.map((h, i) => (
          <View
            key={i}
            style={[
              styles.audioBar,
              {
                height: isPlaying ? h : Math.max(Math.round(h * 0.55), 2),
                backgroundColor: isPlaying ? theme.accent : (theme.textSub + '66'),
              },
            ]}
          />
        ))}
      </View>
      <Text style={[styles.audioLabel, { color: theme.textSub }]}>
        {duration != null ? fmtDur(duration) : '🎤'}
      </Text>
    </TouchableOpacity>
  );
}

// Entrée d'une bulle de message : fade + léger glissement (vertical + côté) + scale.
// L'animation ne joue qu'au MONTAGE (key=msg.id stable) → seules les nouvelles
// bulles s'animent, jamais les anciennes à chaque rendu. transform+opacity only.
function AnimatedMsgRow({ mine, style, children }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 230, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: t,
          transform: [
            { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
            { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [mine ? 8 : -8, 0] }) },
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Badge ❤️ : pop élastique à l'apparition (spring 0.4 → 1, léger dépassement).
// Monte quand is_liked passe à true → l'animation joue pile au like.
function LikeBadge({ style, bg, textStyle }) {
  const s = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.spring(s, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 14 }).start();
  }, []);
  return (
    <Animated.View style={[style, { backgroundColor: bg, transform: [{ scale: s }] }]}>
      <Text style={textStyle}>❤️</Text>
    </Animated.View>
  );
}

// Icônes de statut de lecture — 3 états :
//   sending  : id optimiste → 1 coche grise
//   delivered: read_at null → 2 coches grises
//   read     : read_at set  → 2 coches colorées (accent)
function ReadStatus({ msg, accentColor, subColor }) {
  const isSending = typeof msg.id === 'string' && msg.id.startsWith('opt-');
  const isRead = !!msg.read_at;
  const color = isRead ? accentColor : subColor;
  if (isSending) {
    return <Feather name="check" size={11} color={subColor} style={{ marginLeft: 3 }} />;
  }
  return (
    <View style={{ flexDirection: 'row', marginLeft: 3, gap: -6 }}>
      <Feather name="check" size={11} color={color} />
      <Feather name="check" size={11} color={color} />
    </View>
  );
}

// Bulle de message avec swipe-to-reply (PanResponder)
// mine=false → swipe droite déclenche la réponse
function SwipeableMessageBubble({ msg, mine, onReply, children, style }) {
  const swipeX = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        !mine && Math.abs(gs.dx) > 6 && Math.abs(gs.dy) < gs.dx,
      onPanResponderMove: (_, gs) => {
        if (!mine && gs.dx > 0) swipeX.setValue(Math.min(gs.dx, 72));
      },
      onPanResponderRelease: (_, gs) => {
        if (!mine && gs.dx > 48) {
          onReply(msg);
        }
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, speed: 22, bounciness: 8 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, speed: 22, bounciness: 8 }).start();
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[style, { transform: [{ translateX: swipeX }] }]}
      {...panResponder.panHandlers}
    >
      {children}
    </Animated.View>
  );
}

// Indicateur « en train d'écrire… » — 3 points qui rebondissent
function TypingDots({ color }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(d, { toValue: -4, duration: 250, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 250, useNativeDriver: true }),
          Animated.delay((2 - i) * 150),
        ]),
      ),
    );
    anims.forEach(a => a.start());
    return () => anims.forEach(a => a.stop());
  }, []);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 12 }}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color, transform: [{ translateY: d }] }} />
      ))}
    </View>
  );
}

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
function GradientAvatar({ uri, initial, size = 52, colors, theme, hasStory, showOnlineDot, badgeEmoji }) {
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
      {(showOnlineDot || badgeEmoji) && (
        badgeEmoji ? (
          <View style={[styles.statusBadge, { borderColor: theme.bg, right: hasStory ? 1 : 0, bottom: hasStory ? 1 : 0, backgroundColor: theme.card }]}>
            <Text style={{ fontSize: Math.round(size * 0.22), lineHeight: Math.round(size * 0.28) }}>{badgeEmoji}</Text>
          </View>
        ) : (
          <View style={[styles.onlineDot, { borderColor: theme.bg, right: hasStory ? 2 : 1, bottom: hasStory ? 2 : 1 }]} />
        )
      )}
    </View>
  );
}

// Mémoïsé : évite de re-rendre chaque ligne de la liste d'amis quand un state
// sans rapport change ailleurs dans l'écran (saisie chat, typing, replyingTo...).
// Mémoïsé : évite de re-rendre chaque bulle (PanResponder, Animated.Value,
// waveform audio...) quand un state sans rapport change (saisie, typing...).
// Le fil de discussion n'est donc plus 100% remonté en permanence côté FlatList.
const MessageBubble = memo(function MessageBubble({
  msg, mine, parentMsg, selectedFriendUsername, userId, theme, msgImgSize, showSnapNotes,
  playingAudioId, audioDuration, onReply, onBubbleTap, onBubbleLongPress, onPlayAudio, onOpenUserProfile,
}) {
  return (
    <AnimatedMsgRow mine={mine} style={[styles.msgRow, mine ? styles.msgRowRight : styles.msgRowLeft]}>
      <SwipeableMessageBubble
        msg={msg}
        mine={mine}
        onReply={onReply}
        style={[styles.swipeableBubbleWrap, mine ? styles.msgRowRight : styles.msgRowLeft]}
      >
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => onBubbleTap(msg)}
          onLongPress={() => onBubbleLongPress(msg)}
          delayLongPress={350}
          style={[
            styles.bubble,
            mine
              ? [styles.bubbleSent, { backgroundColor: theme.accent + '22', borderColor: theme.accent + '44', borderWidth: 1 }]
              : [styles.bubbleRecv, { backgroundColor: theme.card }],
          ]}
        >
          {/* Citation du message parent */}
          {parentMsg && !msg.is_deleted && (
            <View style={[styles.replyQuote, { borderLeftColor: mine ? theme.accent : theme.accent + '88', backgroundColor: mine ? theme.accent + '11' : theme.border + '55' }]}>
              <Text style={[styles.replyQuoteSender, { color: mine ? theme.accent : theme.textSub }]}>
                {parentMsg.sender_id === userId ? 'Toi' : selectedFriendUsername}
              </Text>
              <Text style={[styles.replyQuoteText, { color: theme.textSub }]} numberOfLines={1}>
                {parentMsg.is_deleted ? 'Message supprimé' : (parentMsg.content || (parentMsg.image_url ? '📸 Photo' : (parentMsg.audio_url ? '🎤 Audio' : '')))}
              </Text>
            </View>
          )}
          {msg.is_deleted ? (
            <Text style={[styles.bubbleDeleted, { color: theme.textSub }]}>Ce message a été supprimé</Text>
          ) : (() => {
            // Carte de profil partagé
            let profileCard = null;
            if (msg.content?.startsWith('{"_type":"profile"')) {
              try { profileCard = JSON.parse(msg.content); } catch (_) {}
            }
            if (profileCard) {
              return (
                <TouchableOpacity style={[styles.profileCardMsg, { borderColor: theme.border }]} onPress={() => onOpenUserProfile(profileCard.id)} activeOpacity={0.8}>
                  <GradientAvatar uri={profileCard.avatar_url} initial={profileCard.username?.[0]?.toUpperCase()} size={38} colors={['#ED93B1', '#FF4567']} theme={theme} hasStory={false} showOnlineDot={false} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.profileCardName, { color: theme.textPri }]}>@{profileCard.username}</Text>
                    <Text style={[styles.profileCardSub, { color: theme.accent }]}>Voir le profil →</Text>
                  </View>
                </TouchableOpacity>
              );
            }
            return (
              <>
                {msg.audio_url ? (
                  <AudioMessage
                    url={msg.audio_url}
                    isPlaying={playingAudioId === msg.id}
                    onPlay={() => onPlayAudio(msg.id, msg.audio_url)}
                    theme={theme}
                    duration={audioDuration}
                  />
                ) : (
                  <>
                    {msg.content ? <Text style={[styles.bubbleText, { color: theme.textPri }]}>{msg.content}</Text> : null}
                    {msg.image_url ? (
                      <>
                        <ExpoImage source={{ uri: msg.image_url }} style={[styles.msgImage, { width: msgImgSize, height: msgImgSize }]} contentFit="cover" />
                        {showSnapNotes && typeof msg.score_global === 'number' && (
                          <View style={[styles.snapNotesRow, { width: msgImgSize }]}>
                            <View style={[styles.snapNoteGlobal, { backgroundColor: theme.accent }]}>
                              <Feather name="star" size={10} color="#fff" />
                              <Text style={styles.snapNoteGlobalText}>{fmtSnapNote(msg.score_global)}</Text>
                            </View>
                            {SNAP_NOTES.map(n => (
                              <View key={n.key} style={[styles.snapNoteChip, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                                <Text style={[styles.snapNoteLabel, { color: theme.textSub }]}>{n.label}</Text>
                                <Text style={[styles.snapNoteScore, { color: theme.accent }]}>{fmtSnapNote(msg[n.key])}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </>
                    ) : null}
                  </>
                )}
              </>
            );
          })()}
          <View style={styles.msgMetaRow}>
            <Text style={[styles.msgTime, { color: theme.textSub }]}>
              {new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
            </Text>
            {mine && !msg.is_deleted && (
              <ReadStatus msg={msg} accentColor={theme.accent} subColor={theme.textSub} />
            )}
          </View>
          {msg.is_liked && !msg.is_deleted && (
            <LikeBadge
              style={[styles.likeBadge, mine ? styles.likeBadgeLeft : styles.likeBadgeRight]}
              bg={theme.bg}
              textStyle={styles.likeBadgeText}
            />
          )}
        </TouchableOpacity>
      </SwipeableMessageBubble>
    </AnimatedMsgRow>
  );
});

const ConversationRow = memo(function ConversationRow({
  item, index, fi, lc, hasStory, lastMsgPreview, msgTime, unreadCount, onOpenChat, onOpenRestore, theme,
}) {
  return (
    <AnimatedEntrance delay={Math.min(index, 8) * 45} distance={14}>
      <TouchableOpacity style={[styles.convRow, { borderBottomColor: theme.border }]} onPress={() => onOpenChat(item)} activeOpacity={0.75}>
        <GradientAvatar
          uri={item.avatar_url}
          initial={item.username?.[0]?.toUpperCase()}
          size={54}
          colors={lc.frameBorderColor ? [lc.frameBorderColor, lc.frameBorderColor] : ['#ED93B1', '#FF4567']}
          theme={theme}
          hasStory={hasStory}
          badgeEmoji={lc.badge}
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
          {unreadCount > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: theme.accent }]}>
              <Text style={styles.unreadBadgeText}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
          {fi.state === 'active' && fi.streak > 0 && (
            <View style={styles.streakRow}>
              <Text style={[styles.streakText, { color: theme.accent }]}>🔥 {fi.streak}</Text>
            </View>
          )}
          {fi.state === 'expired' && (
            <TouchableOpacity style={styles.streakRow} onPress={() => onOpenRestore(item)}>
              <Text style={[styles.streakText, styles.flammeDim, { color: theme.textSub }]}>🔥 {fi.streak}</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    </AnimatedEntrance>
  );
});

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
  const [localFilter, setLocalFilter] = useState('');
  const [shareProfilePicker, setShareProfilePicker] = useState({ visible: false, targetProfile: null });
  const [showSnapCamera, setShowSnapCamera] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [messages, setMessages] = useState([]);
  const [showSnapNotes, setShowSnapNotes] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingTimerRef = useRef(null);
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const [audioDurations, setAudioDurations] = useState({});
  const audioRecordingRef = useRef(null);
  const audioSoundRef = useRef(null);

  // Nettoyage au démontage de l'écran : un enregistrement/lecture audio en
  // cours ne doit pas continuer (setState sur composant démonté, son jamais libéré).
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (audioRecordingRef.current) {
        audioRecordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
      if (audioSoundRef.current) {
        audioSoundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

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
  const route = useRoute();
  const firstFocus = useRef(true);
  const [restoreModal, setRestoreModal] = useState({ visible: false, friend: null });
  const [restoring, setRestoring] = useState(false);
  const [profileModal, setProfileModal] = useState({ visible: false, profile: null, loading: false });
  const [replyingTo, setReplyingTo] = useState(null); // { id, content, senderName, imageUrl }
  const [friendTyping, setFriendTyping] = useState(false);
  const typingChannelRef = useRef(null);
  const typingSentAtRef = useRef(0);
  const typingStopTimer = useRef(null);   // côté émetteur : envoie typing:false après pause
  const typingHideTimer = useRef(null);   // côté récepteur : masque les points si plus de signal

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

    const allIds = [user.id, ...friendIds];
    const nowIso = new Date().toISOString();

    // Aucune de ces requêtes ne dépend du résultat d'une autre (toutes filtrées
    // sur user.id/friendIds/allIds déjà connus) → lancées en parallèle plutôt
    // qu'en cascade (gain net sur le fetch le plus lourd de l'écran Chat).
    const [
      { data: plist },
      { data: incRows },
      { data: out },
      { data: flammesData },
      { data: storiesData },
      msgsResult,
    ] = await Promise.all([
      supabase.from('profiles').select('id, username, avatar_url, active_logo, flame_freezes').in('id', allIds),
      supabase.from('friendships').select('user_id, created_at').eq('friend_id', user.id).eq('status', 'pending'),
      supabase.from('friendships').select('friend_id').eq('user_id', user.id).eq('status', 'pending'),
      supabase.from('flammes').select('id, user1_id, user2_id, streak, last_snap_at').or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`),
      supabase.from('stories').select('id, user_id, image_url, video_url, overlay_text, caption, expires_at').in('user_id', allIds).gt('expires_at', nowIso).order('created_at', { ascending: false }),
      friendIds.length
        ? supabase.from('messages').select('sender_id, receiver_id, content, image_url, is_deleted, created_at').or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(60)
        : Promise.resolve(null),
    ]);

    const profileById = Object.fromEntries((plist || []).map(p => [p.id, p]));
    const merged = friendIds.map(id => ({ id, ...profileById[id] })).filter(r => r.username != null);
    setFriends(merged);
    setMyProfile(profileById[user.id] || null);
    // Pré-charge en arrière-plan les avatars des contacts (cache expo-image)
    const avatarUrls = merged.map(f => f.avatar_url).filter(Boolean);
    if (avatarUrls.length) ExpoImage.prefetch(avatarUrls).catch(() => {});

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

    setOutgoingPendingIds((out || []).map(r => r.friend_id));

    setFlammes(flammesData || []);

    const activeStories = (storiesData || []).map(s => ({
      ...s,
      profiles: profileById[s.user_id]
        ? { username: profileById[s.user_id].username, avatar_url: profileById[s.user_id].avatar_url }
        : null,
    }));
    setStories(activeStories);
    setMyStory(activeStories.find(s => s.user_id === user.id) || null);

    // Dernier message par ami (pour preview dans la liste)
    if (friendIds.length && msgsResult) {
      const byFriend = {};
      const counts = {};
      for (const msg of (msgsResult.data || [])) {
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

  // Conversations triées : dernier message (reçu ou envoyé) le plus récent en haut.
  const sortedFriends = useMemo(() => {
    const ts = (id) => {
      const m = lastMessages[id];
      return m?.created_at ? new Date(m.created_at).getTime() : 0;
    };
    return [...friends].sort((a, b) => ts(b.id) - ts(a.id));
  }, [friends, lastMessages]);

  // Realtime (vue liste) : un message reçu remonte la conversation en haut + non-lus.
  const selectedFriendRef = useRef(null);
  useEffect(() => { selectedFriendRef.current = selectedFriend?.id || null; }, [selectedFriend]);
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`list-msgs-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `receiver_id=eq.${userId}` }, (payload) => {
        const m = payload.new;
        if (!m) return;
        const fid = m.sender_id;
        setLastMessages(prev => ({ ...prev, [fid]: m }));   // déclenche le re-tri
        if (selectedFriendRef.current !== fid) {
          setUnreadCounts(prev => ({ ...prev, [fid]: (prev[fid] || 0) + 1 }));
        }
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [userId]);

  // Signale la conversation ouverte uniquement quand l'onglet Chat a le focus.
  // Au blur (changement d'onglet), on efface → la bannière in-app reprend.
  useFocusEffect(useCallback(() => {
    if (view === 'chat' && selectedFriend) setActiveChat(selectedFriend.id);
    return () => setActiveChat(null);
  }, [view, selectedFriend]));

  // Ouverture directe d'une conversation depuis la bannière in-app (param de navigation)
  useEffect(() => {
    const openId = route.params?.openFriendId;
    if (!openId || !friends.length) return;
    const friend = friends.find(f => f.id === openId);
    if (friend) {
      openChat(friend);
      navigation.setParams({ openFriendId: undefined });
    }
  }, [route.params?.openFriendId, friends]);

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

  const normalizeStr = (s) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')    // accents / diacritiques → base ASCII
      .replace(/[^\x00-\x7F]/g, ' ')      // emoji + caractères non-ASCII → espace
      .replace(/[^a-z0-9_\s]/gi, '')      // ponctuation résiduelle → supprimée
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const searchUsers = async (query) => {
    setSearchQuery(query);
    const queryClean = query.trim();
    if (queryClean.length < 2) { setSearchResults([]); return; }
    const normalized = normalizeStr(queryClean);
    // Trois patterns : brut (casse ignorée), sans accents, sans emoji/spéciaux
    const patterns = [...new Set([queryClean.toLowerCase(), normalized])].filter(p => p.length >= 2);
    const all = await Promise.all(
      patterns.map(p => supabase.from('profiles').select('id, username, avatar_url, active_logo').ilike('username', `%${p}%`).neq('id', userId).limit(10)),
    );
    const seen = new Set();
    const merged = [];
    for (const { data } of all) {
      for (const item of (data || [])) {
        if (!seen.has(item.id)) { seen.add(item.id); merged.push(item); }
      }
    }
    setSearchResults(merged.slice(0, 12));
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

  // Index O(1) par ami plutôt qu'un .find() linéaire répété à chaque ligne de la liste.
  const flammeByFriendId = useMemo(() => {
    const map = new Map();
    for (const f of flammes) {
      const other = f.user1_id === userId ? f.user2_id : f.user1_id;
      map.set(other, f);
    }
    return map;
  }, [flammes, userId]);

  const storiesByUserId = useMemo(() => {
    const map = new Map();
    for (const s of stories) if (!map.has(s.user_id)) map.set(s.user_id, s);
    return map;
  }, [stories]);

  const getFlammeInfo = useCallback((friendId) => {
    const flamme = flammeByFriendId.get(friendId) || null;
    if (!flamme || !flamme.streak) return { flamme, streak: 0, state: 'none' };
    const age = Date.now() - (flamme.last_snap_at ? new Date(flamme.last_snap_at).getTime() : 0);
    if (age <= FLAME_EXPIRE_MS)  return { flamme, streak: flamme.streak, state: 'active' };
    if (age <= FLAME_RESTORE_MS) return { flamme, streak: flamme.streak, state: 'expired' };
    return { flamme, streak: 0, state: 'dead' };
  }, [flammeByFriendId]);

  // ── Restauration manuelle d'une flamme éteinte via un Gel de Flamme ────────
  const openRestore = (friend) => setRestoreModal({ visible: true, friend });

  const goToShop = () => { try { navigation.navigate('Shop'); } catch (_) {} };

  const sendProfileShare = async (friendId) => {
    const p = shareProfilePicker.targetProfile;
    if (!p || !friendId) return;
    const content = JSON.stringify({ _type: 'profile', id: p.id, username: p.username, avatar_url: p.avatar_url || null });
    const { error } = await supabase.from('messages').insert({ sender_id: userId, receiver_id: friendId, content });
    if (error) { showToast('Envoi impossible', { type: 'error' }); return; }
    setShareProfilePicker({ visible: false, targetProfile: null });
    setProfileModal({ visible: false, profile: null, loading: false });
    showToast(`Profil de @${p.username} partagé !`, { type: 'success' });
  };

  const renderShareProfilePicker = () => (
    <Modal
      visible={shareProfilePicker.visible}
      transparent
      animationType="slide"
      onRequestClose={() => setShareProfilePicker({ visible: false, targetProfile: null })}
    >
      <View style={styles.profileModalOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={() => setShareProfilePicker({ visible: false, targetProfile: null })} />
        <View style={[styles.sharePickerSheet, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.settingsHandle, { backgroundColor: theme.border }]} />
          <Text style={[styles.sharePickerTitle, { color: theme.textPri }]}>
            Partager @{shareProfilePicker.targetProfile?.username}
          </Text>
          <Text style={[styles.sharePickerSub, { color: theme.textSub }]}>Choisir un ami à qui envoyer ce profil</Text>
          <FlatList
            data={friends}
            keyExtractor={f => f.id}
            style={{ maxHeight: 320 }}
            renderItem={({ item }) => {
              const lc = getLogoConfig(item.active_logo);
              return (
                <TouchableOpacity
                  style={[styles.sharePickerRow, { borderBottomColor: theme.border }]}
                  onPress={() => sendProfileShare(item.id)}
                  activeOpacity={0.75}
                >
                  <GradientAvatar uri={item.avatar_url} initial={item.username?.[0]?.toUpperCase()} size={42} colors={lc.frameBorderColor ? [lc.frameBorderColor, lc.frameBorderColor] : ['#ED93B1', '#FF4567']} theme={theme} hasStory={false} showOnlineDot={false} />
                  <View style={styles.convNameRow}>
                    <Text style={[styles.sharePickerName, { color: theme.textPri }]}>{item.username}</Text>
                    {lc.badge ? <Text style={styles.convNameBadge}>{lc.badge}</Text> : null}
                  </View>
                  <Feather name="send" size={18} color={theme.accent} />
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={[styles.noResults, { color: theme.textSub }]}>Aucun ami</Text>}
          />
        </View>
      </View>
    </Modal>
  );

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
                {profileModal.profile.id !== userId && (() => {
                  const rel = relationForSearchProfile(profileModal.profile.id);
                  if (rel === 'friend') return (
                    <View style={[styles.profileShareBtn, { backgroundColor: theme.accent + '22' }]}>
                      <Feather name="check" size={14} color={theme.accent} />
                      <Text style={[styles.profileShareBtnText, { color: theme.accent }]}>Déjà amis</Text>
                    </View>
                  );
                  if (rel === 'outgoing') return (
                    <View style={[styles.profileShareBtn, { backgroundColor: theme.border }]}>
                      <Feather name="clock" size={14} color={theme.textSub} />
                      <Text style={[styles.profileShareBtnText, { color: theme.textSub }]}>Demande envoyée</Text>
                    </View>
                  );
                  if (rel === 'incoming') return (
                    <TouchableOpacity
                      style={[styles.profileShareBtn, { backgroundColor: '#4CD964' }]}
                      onPress={() => { acceptRequest(profileModal.profile.id); setProfileModal({ visible: false, profile: null, loading: false }); }}
                    >
                      <Feather name="user-check" size={14} color="#fff" />
                      <Text style={styles.profileShareBtnText}>Accepter la demande</Text>
                    </TouchableOpacity>
                  );
                  return (
                    <TouchableOpacity
                      style={[styles.profileShareBtn, { backgroundColor: theme.accent }]}
                      onPress={() => { sendFriendRequest(profileModal.profile.id); }}
                    >
                      <Feather name="user-plus" size={14} color="#fff" />
                      <Text style={styles.profileShareBtnText}>Demander en ami</Text>
                    </TouchableOpacity>
                  );
                })()}
                {profileModal.profile.id !== userId && (
                  <TouchableOpacity
                    style={[styles.profileShareBtn, { backgroundColor: theme.accent + '22' }]}
                    onPress={() => {
                      const p = profileModal.profile;
                      setProfileModal({ visible: false, profile: null, loading: false });
                      setShareProfilePicker({ visible: true, targetProfile: p });
                    }}
                  >
                    <Feather name="share-2" size={14} color={theme.accent} />
                    <Text style={[styles.profileShareBtnText, { color: theme.accent }]}>Partager le profil</Text>
                  </TouchableOpacity>
                )}
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
      .select('id, sender_id, receiver_id, content, image_url, audio_url, is_liked, is_deleted, read_at, reply_to_id, score_global, score_couleurs, score_coupe, score_tendance, created_at, expires_at')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${friend.id}),and(sender_id.eq.${friend.id},receiver_id.eq.${userId})`)
      .gt('expires_at', now)
      .order('created_at', { ascending: true })
      .limit(60);
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
    setActiveChat(friend.id);
    // Efface les notifications push de cette conversation (centre de notif)
    dismissChatNotifications(friend.id);
    await loadMessages(friend);
    supabase.rpc('mark_messages_read', { p_friend_id: friend.id }).catch(() => {});
  };

  // Wrappers à identité stable (toujours la dernière version via ref) pour que
  // renderConversationItem/ConversationRow ci-dessous restent mémoïsables.
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;
  const stableOpenChat = useCallback((friend) => openChatRef.current(friend), []);

  const openRestoreRef = useRef(openRestore);
  openRestoreRef.current = openRestore;
  const stableOpenRestore = useCallback((friend) => openRestoreRef.current(friend), []);

  const renderConversationItem = useCallback(({ item, index }) => {
    const fi = getFlammeInfo(item.id);
    const lc = getLogoConfig(item.active_logo);
    const lastMsg = lastMessages[item.id];
    const hasStory = storiesByUserId.has(item.id);
    const lastMsgPreview = lastMsg?.is_deleted
      ? '🗑 Message supprimé'
      : lastMsg?.image_url
        ? '📸 Photo'
        : lastMsg?.content?.startsWith('{"_type":"profile"')
          ? '👤 Profil partagé'
          : lastMsg?.content || 'Nouveau contact';
    const msgTime = lastMsg ? lastMsgTime(lastMsg.created_at) : '';
    return (
      <ConversationRow
        item={item}
        index={index}
        fi={fi}
        lc={lc}
        hasStory={hasStory}
        lastMsgPreview={lastMsgPreview}
        msgTime={msgTime}
        unreadCount={unreadCounts[item.id] || 0}
        onOpenChat={stableOpenChat}
        onOpenRestore={stableOpenRestore}
        theme={theme}
      />
    );
  }, [getFlammeInfo, lastMessages, storiesByUserId, unreadCounts, stableOpenChat, stableOpenRestore, theme]);

  const leaveChat = () => {
    setActiveChat(null);
    setFriendTyping(false);
    setView('list');
    setMessages([]);
    setReplyingTo(null);
  };

  // ── Auto-scroll vers le bas du fil de messages ─────────────────────────────
  // onContentSizeChange couvre TOUS les cas (ouverture, envoi, réception realtime,
  // animations d'entrée) sans toucher à la logique des messages. Premier affichage :
  // saut immédiat ; messages suivants : défilement animé fluide.
  const msgListRef = useRef(null);
  const didInitialScroll = useRef(false);
  useEffect(() => { didInitialScroll.current = false; }, [selectedFriend]);

  // ── Like / suppression de messages (synchro temps réel) ────────────────────
  const lastTapRef = useRef({ id: null, t: 0 });

  // Abonnement realtime : likes, suppressions et messages entrants de la conversation
  useEffect(() => {
    if (!userId || !selectedFriend) return;
    const channel = supabase
      .channel(`chat-${userId}-${selectedFriend.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        // UPDATE traité en priorité par id — sans inPair (sender_id/receiver_id peuvent être absents)
        if (payload.eventType === 'UPDATE' && payload.new?.id) {
          setMessages((prev) =>
            prev.some((m) => m.id === payload.new.id)
              ? prev.map((m) => (m.id === payload.new.id ? { ...m, ...payload.new } : m))
              : prev
          );
          return;
        }
        const row = payload.new && payload.new.id ? payload.new : payload.old;
        if (!row) return;
        const inPair =
          (row.sender_id === userId && row.receiver_id === selectedFriend.id) ||
          (row.sender_id === selectedFriend.id && row.receiver_id === userId);
        if (!inPair) return;
        if (payload.eventType === 'INSERT') {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            // Retire le placeholder optimiste (même expéditeur + contenu)
            const filtered = prev.filter(m => !(
              typeof m.id === 'string' && m.id.startsWith('opt-') &&
              m.sender_id === payload.new.sender_id && m.content === payload.new.content
            ));
            return [...filtered, payload.new];
          });
          // Message reçu pendant que le chat est ouvert → accusé de lecture immédiat
          if (payload.new.sender_id === selectedFriend.id) {
            setFriendTyping(false);
            supabase.rpc('mark_messages_read', { p_friend_id: selectedFriend.id }).catch(() => {});
          }
        } else if (payload.eventType === 'DELETE') {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, selectedFriend]);

  // Subscription dédiée aux accusés de lecture (filtre serveur = livraison garantie)
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`read-receipts-${userId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `sender_id=eq.${userId}`,
      }, (payload) => {
        if (!payload.new?.id) return;
        setMessages((prev) =>
          prev.some((m) => m.id === payload.new.id)
            ? prev.map((m) => (m.id === payload.new.id ? { ...m, ...payload.new } : m))
            : prev
        );
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  // ── Indicateur « en train d'écrire… » via Supabase Broadcast ───────────────
  // Canal partagé déterministe (ids triés) entre les deux participants.
  useEffect(() => {
    if (!userId || !selectedFriend) { typingChannelRef.current = null; return; }
    const pairKey = [userId, selectedFriend.id].sort().join('-');
    const channel = supabase.channel(`typing-${pairKey}`, { config: { broadcast: { self: false } } });
    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.from !== selectedFriend.id) return;
        setFriendTyping(!!payload.typing);
        if (payload.typing) {
          if (typingHideTimer.current) clearTimeout(typingHideTimer.current);
          // Filet de sécurité : masque les points si plus aucun signal après 4s
          typingHideTimer.current = setTimeout(() => setFriendTyping(false), 4000);
        }
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      if (typingHideTimer.current) clearTimeout(typingHideTimer.current);
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
    };
  }, [userId, selectedFriend]);

  const broadcastTyping = (isTyping) => {
    const ch = typingChannelRef.current;
    if (!ch) return;
    ch.send({ type: 'broadcast', event: 'typing', payload: { from: userId, typing: isTyping } });
  };

  const onChangeMessageText = (text) => {
    setMessageText(text);
    const now = Date.now();
    // Throttle l'émission « typing:true » à 1×/1.5s
    if (now - typingSentAtRef.current > 1500) {
      typingSentAtRef.current = now;
      broadcastTyping(true);
    }
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = setTimeout(() => { broadcastTyping(false); typingSentAtRef.current = 0; }, 2000);
  };

  const toggleLike = async (msg) => {
    if (msg.sender_id === userId || msg.is_deleted) return; // on ne like que les messages reçus
    const next = !msg.is_liked;
    if (next) triggerHaptic(12); // micro-vibration au like (cohérent avec le Feed)
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
    // Deep link : le destinataire ouvre la conversation avec MOI (l'expéditeur).
    // tag = chat-<monId> → regroupe/remplace + permet l'effacement à l'ouverture.
    supabase.functions
      .invoke('send-web-push', {
        body: { recipient_id: friendId, title, body, url: `/?chat=${userId}`, tag: `chat-${userId}` },
      })
      .catch(() => {});
  };

  const sendTextMessage = async () => {
    if (!messageText.trim() || !selectedFriend || sendingMessage) return;
    const text = messageText.trim();
    const replyId = replyingTo?.id ?? null;
    setMessageText('');
    setReplyingTo(null);
    // Stoppe l'indicateur « en train d'écrire » immédiatement
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingSentAtRef.current = 0;
    broadcastTyping(false);
    // Optimistic : affiche le message immédiatement, Realtime le remplacera par la vraie ligne
    const tempId = 'opt-' + Date.now();
    const tempMsg = {
      id: tempId, sender_id: userId, receiver_id: selectedFriend.id, content: text,
      image_url: null, is_liked: false, is_deleted: false, read_at: null,
      reply_to_id: replyId,
      created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
    };
    setMessages(prev => [...prev, tempMsg]);
    setLastMessages(prev => ({ ...prev, [selectedFriend.id]: tempMsg })); // remonte la conv en haut
    try {
      const insertPayload = { sender_id: userId, receiver_id: selectedFriend.id, content: text };
      if (replyId) insertPayload.reply_to_id = replyId;
      const { error } = await supabase.from('messages').insert(insertPayload);
      if (error) throw error;
      notifyFriend(selectedFriend.id, myProfile?.username || 'Nouveau message', text.slice(0, 120));
    } catch (e) {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      showToast(e?.message || 'Envoi impossible', { type: 'error' });
    }
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) { showToast('Permission micro refusée', { type: 'warning' }); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      audioRecordingRef.current = recording;
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
      setIsRecording(true);
    } catch (e) { showToast(e?.message || 'Erreur micro', { type: 'error' }); }
  };

  const stopAndSendRecording = async () => {
    const recording = audioRecordingRef.current;
    if (!recording) return;
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    const capturedDuration = recordingDuration;
    setIsRecording(false);
    setRecordingDuration(0);
    audioRecordingRef.current = null;
    // Vocal trop court (< 1 s) → annulation silencieuse
    if (capturedDuration < 1) {
      try { await recording.stopAndUnloadAsync(); } catch (_) {}
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }); } catch (_) {}
      return;
    }
    setSendingMessage(true);
    try {
      await recording.stopAndUnloadAsync();
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }); } catch (_) {}
      const uri = recording.getURI();
      if (!uri) throw new Error('Enregistrement vide');
      // Sur web expo-av enregistre en webm/opus ; sur mobile en m4a (container mp4)
      const isWeb = Platform.OS === 'web';
      const fileExt = isWeb ? 'webm' : 'm4a';
      const contentType = isWeb ? 'audio/webm' : 'audio/mp4';
      const fileName = `audio/${userId}/${Date.now()}.${fileExt}`;
      const fetchResponse = await fetch(uri);
      if (!fetchResponse.ok) throw new Error("Impossible de lire l'enregistrement");
      const blob = await fetchResponse.blob();
      const { error: uploadError } = await supabase.storage.from('ootds').upload(fileName, blob, { contentType });
      if (uploadError) throw new Error(`Upload échoué : ${uploadError.message}`);
      const { data: urlData } = supabase.storage.from('ootds').getPublicUrl(fileName);
      const insertPayload = {
        sender_id: userId,
        receiver_id: selectedFriend.id,
        audio_url: urlData.publicUrl,
      };
      if (replyingTo?.id) insertPayload.reply_to_id = replyingTo.id;
      const { data: inserted, error } = await supabase.from('messages').insert(insertPayload).select('id, created_at, expires_at').single();
      if (error) throw error;
      // Affichage immédiat sans attendre Realtime (évite la race condition lecture locale)
      setMessages(prev => {
        if (prev.some(m => m.id === inserted.id)) return prev;
        return [...prev, {
          id: inserted.id,
          sender_id: userId,
          receiver_id: selectedFriend.id,
          audio_url: urlData.publicUrl,
          content: null,
          image_url: null,
          is_liked: false,
          is_deleted: false,
          read_at: null,
          reply_to_id: replyingTo?.id ?? null,
          created_at: inserted.created_at,
          expires_at: inserted.expires_at,
        }];
      });
      setReplyingTo(null);
      notifyFriend(selectedFriend.id, myProfile?.username || 'OOTD', '🎤 t\'a envoyé un message vocal');
    } catch (e) {
      console.error('[stopAndSendRecording]', e?.message || e);
      showToast(e?.message || 'Erreur envoi vocal', { type: 'error' });
    }
    setSendingMessage(false);
  };

  const playAudioMsg = async (msgId, url) => {
    if (!url || !url.startsWith('http')) {
      showToast('URL audio invalide', { type: 'error' });
      return;
    }
    // Stoppe et décharge le son précédent
    if (audioSoundRef.current) {
      try { await audioSoundRef.current.stopAsync(); await audioSoundRef.current.unloadAsync(); } catch (_) {}
      audioSoundRef.current = null;
    }
    // Deuxième clic sur le même message = pause
    if (playingAudioId === msgId) { setPlayingAudioId(null); return; }
    try {
      // setAudioModeAsync peut échouer silencieusement sur web
      try { await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false }); } catch (_) {}
      const { sound, status } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true },
        (s) => { if (s.didJustFinish || s.error) { setPlayingAudioId(null); audioSoundRef.current = null; } },
      );
      if (!status.isLoaded) {
        throw new Error(status.error ? `Codec non supporté : ${status.error}` : 'Fichier audio non chargé');
      }
      if (status.durationMillis) {
        setAudioDurations(prev => ({ ...prev, [msgId]: Math.round(status.durationMillis / 1000) }));
      }
      audioSoundRef.current = sound;
      setPlayingAudioId(msgId);
    } catch (e) {
      console.error('[playAudioMsg]', e?.message || e);
      showToast(e?.message || 'Lecture impossible', { type: 'error' });
    }
  };

  // Wrappers à identité stable (toujours la dernière version via ref) pour que
  // renderMessageItem/MessageBubble restent mémoïsables malgré les fermetures
  // internes changeantes de ces handlers.
  const handleBubbleTapRef = useRef(handleBubbleTap);
  handleBubbleTapRef.current = handleBubbleTap;
  const stableBubbleTap = useCallback((msg) => handleBubbleTapRef.current(msg), []);

  const handleBubbleLongPressRef = useRef(handleBubbleLongPress);
  handleBubbleLongPressRef.current = handleBubbleLongPress;
  const stableBubbleLongPress = useCallback((msg) => handleBubbleLongPressRef.current(msg), []);

  const playAudioMsgRef = useRef(playAudioMsg);
  playAudioMsgRef.current = playAudioMsg;
  const stablePlayAudio = useCallback((msgId, url) => playAudioMsgRef.current(msgId, url), []);

  const openUserProfileRef = useRef(openUserProfile);
  openUserProfileRef.current = openUserProfile;
  const stableOpenUserProfile = useCallback((id) => openUserProfileRef.current(id), []);

  const handleReply = useCallback((m) => {
    const isFromMe = m.sender_id === userId;
    setReplyingTo({
      id: m.id,
      content: m.is_deleted ? 'Message supprimé' : (m.content || (m.image_url ? '📸 Photo' : (m.audio_url ? '🎤 Audio' : ''))),
      senderName: isFromMe ? 'Toi' : selectedFriend?.username,
      imageUrl: m.image_url,
    });
  }, [userId, selectedFriend]);

  // Index O(1) du message parent (swipe-to-reply) plutôt qu'un .find() par bulle.
  const messagesById = useMemo(() => {
    const map = new Map();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const renderMessageItem = useCallback(({ item: msg }) => {
    const mine = msg.sender_id === userId;
    const parentMsg = msg.reply_to_id ? messagesById.get(msg.reply_to_id) : null;
    return (
      <MessageBubble
        msg={msg}
        mine={mine}
        parentMsg={parentMsg}
        selectedFriendUsername={selectedFriend?.username}
        userId={userId}
        theme={theme}
        msgImgSize={msgImgSize}
        showSnapNotes={showSnapNotes}
        playingAudioId={playingAudioId}
        audioDuration={audioDurations[msg.id]}
        onReply={handleReply}
        onBubbleTap={stableBubbleTap}
        onBubbleLongPress={stableBubbleLongPress}
        onPlayAudio={stablePlayAudio}
        onOpenUserProfile={stableOpenUserProfile}
      />
    );
  }, [
    userId, messagesById, selectedFriend, theme, msgImgSize, showSnapNotes,
    playingAudioId, audioDurations, handleReply, stableBubbleTap, stableBubbleLongPress,
    stablePlayAudio, stableOpenUserProfile,
  ]);

  const sendPhotoMessageFromUri = async (uri) => {
    if (!selectedFriend || sendingMessage) return;
    setSendingMessage(true);
    try {
      const fileName = `messages/${userId}/${Date.now()}.jpg`;
      const fetchResponse = await fetch(uri);
      if (!fetchResponse.ok) throw new Error('Impossible de lire la photo');
      const blob = await fetchResponse.blob();
      await supabase.storage.from('ootds').upload(fileName, blob, { contentType: 'image/jpeg' });
      const { data: urlData } = supabase.storage.from('ootds').getPublicUrl(fileName);
      const { error } = await supabase.from('messages').insert({ sender_id: userId, receiver_id: selectedFriend.id, image_url: urlData.publicUrl });
      if (error) throw error;
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
        const newStreak = daysDiff <= 1 ? flamme.streak + 1 : 1;
        await supabase.from('flammes').update({ streak: newStreak, last_snap_at: now.toISOString() }).eq('id', flamme.id);
      } else {
        await supabase.from('flammes').insert({ ...flammeOrderedIds(userId, selectedFriend.id), streak: 1, last_snap_at: now.toISOString() });
      }
      await fetchData({ silent: true });
    } catch (e) { showToast(e?.message || 'Erreur photo', { type: 'error' }); }
    setSendingMessage(false);
  };

  const sendPhotoMessage = async () => {
    if (!selectedFriend || sendingMessage) return;
    if (Platform.OS !== 'web') {
      // Caméra in-app sur native
      setShowSnapCamera(true);
      return;
    }
    // Web : repli galerie
    const libPerm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!libPerm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.5, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled) return;
    await sendPhotoMessageFromUri(result.assets[0].uri);
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
      <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]} edges={[]}>
        {/* Header chat */}
        <View style={[styles.chatHeader, { borderBottomColor: theme.border }]}>
          <TouchableOpacity
            onPress={leaveChat}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Retour"
          >
            <Feather name="chevron-left" size={26} color={theme.textPri} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.chatHeaderInfo} onPress={() => openUserProfile(selectedFriend.id)} activeOpacity={0.8}>
            <GradientAvatar
              uri={selectedFriend.avatar_url}
              initial={selectedFriend.username?.[0]?.toUpperCase()}
              size={40}
              colors={chatLogoConfig.frameBorderColor ? [chatLogoConfig.frameBorderColor, chatLogoConfig.frameBorderColor] : ['#ED93B1', '#FF4567']}
              theme={theme}
              hasStory={storiesByUserId.has(selectedFriend.id)}
              badgeEmoji={chatLogoConfig.badge}
            />
            <View>
              <View style={styles.convNameRow}>
                <Text style={[styles.chatUsername, { color: theme.textPri }]}>{selectedFriend.username}</Text>
                {chatLogoConfig.badge ? <Text style={styles.convNameBadge}>{chatLogoConfig.badge}</Text> : null}
              </View>
              {friendTyping ? (
                <View style={styles.typingRow}>
                  <Text style={[styles.chatStreak, { color: theme.accent }]}>écrit </Text>
                  <TypingDots color={theme.accent} />
                </View>
              ) : (
                <>
                  {chatFlamme.state === 'active' && chatFlamme.streak > 0 && (
                    <Text style={[styles.chatStreak, { color: theme.accent }]}>🔥 {chatFlamme.streak} j</Text>
                  )}
                  {chatFlamme.state === 'expired' && (
                    <TouchableOpacity onPress={() => openRestore(selectedFriend)}>
                      <Text style={[styles.chatStreak, styles.flammeDim, { color: theme.textSub }]}>🔥 {chatFlamme.streak} j · ranimer</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.photoMsgBtn}
            onPress={() => setShowSnapNotes(p => !p)}
            accessibilityRole="button"
            accessibilityLabel={showSnapNotes ? 'Masquer les notes' : 'Afficher les notes'}
            accessibilityState={{ selected: showSnapNotes }}
          >
            <Feather name={showSnapNotes ? 'eye' : 'eye-off'} size={22} color={showSnapNotes ? theme.accent : theme.textPri} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.photoMsgBtn}
            onPress={sendPhotoMessage}
            disabled={sendingMessage}
            accessibilityRole="button"
            accessibilityLabel="Envoyer une photo"
            accessibilityState={{ disabled: sendingMessage }}
          >
            <Feather name="camera" size={22} color={theme.textPri} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
          <FlatList
            ref={msgListRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            style={[styles.msgList, { backgroundColor: theme.bg }]}
            contentContainerStyle={styles.msgListContent}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            maxToRenderPerBatch={10}
            windowSize={10}
            onContentSizeChange={() => {
              msgListRef.current?.scrollToEnd({ animated: didInitialScroll.current });
              didInitialScroll.current = true;
            }}
            ListEmptyComponent={
              <View style={styles.msgEmpty}>
                <Feather name="message-circle" size={40} color={theme.border} />
                <Text style={[styles.msgEmptyText, { color: theme.textPri }]}>Début de la conversation</Text>
                <Text style={[styles.msgEmptySub, { color: theme.textSub }]}>Les messages disparaissent après 24h</Text>
              </View>
            }
            renderItem={renderMessageItem}
          />

          <View style={[styles.inputBar, { backgroundColor: theme.bg, borderTopColor: theme.border }]}>
            {/* Barre de réponse */}
            {replyingTo && (
              <View style={[styles.replyBar, { backgroundColor: theme.card, borderLeftColor: theme.accent, borderTopColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.replyBarSender, { color: theme.accent }]}>{replyingTo.senderName}</Text>
                  <Text style={[styles.replyBarText, { color: theme.textSub }]} numberOfLines={1}>
                    {replyingTo.content || (replyingTo.imageUrl ? '📸 Photo' : '')}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={8}>
                  <Feather name="x" size={18} color={theme.textSub} />
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.msgInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
                placeholder={isRecording
                  ? `🎤  ${Math.floor(recordingDuration / 60).toString().padStart(2, '0')}:${(recordingDuration % 60).toString().padStart(2, '0')}`
                  : 'Écrire un message...'}
                placeholderTextColor={isRecording ? theme.accent : theme.textSub}
                value={messageText}
                onChangeText={onChangeMessageText}
                multiline
                maxLength={500}
                editable={!isRecording}
              />
              {!messageText.trim() && (
                <TouchableOpacity
                  style={[styles.micBtn, { backgroundColor: isRecording ? '#FF4A4A' : theme.card, borderColor: isRecording ? '#FF4A4A44' : theme.border }]}
                  onPress={isRecording ? stopAndSendRecording : startRecording}
                  disabled={sendingMessage && !isRecording}
                  accessibilityRole="button"
                  accessibilityLabel={isRecording ? "Arrêter l'enregistrement" : 'Enregistrer un message vocal'}
                  accessibilityState={{ disabled: !!(sendingMessage && !isRecording) }}
                >
                  {sendingMessage && isRecording
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Feather name={isRecording ? 'stop-circle' : 'mic'} size={18} color={isRecording ? '#fff' : theme.textSub} />
                  }
                </TouchableOpacity>
              )}
              <Bouncy
                style={[styles.sendBtn, { backgroundColor: theme.accent }, (!messageText.trim() || sendingMessage) && { opacity: 0.42 }]}
                onPress={sendTextMessage}
                disabled={!messageText.trim() || sendingMessage}
                accessibilityRole="button"
                accessibilityLabel="Envoyer le message"
                accessibilityState={{ disabled: !!((!messageText.trim()) || sendingMessage) }}
              >
                {sendingMessage && !isRecording
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Feather name="send" size={16} color="#fff" />
                }
              </Bouncy>
            </View>
          </View>
        </KeyboardAvoidingView>
        {renderRestoreModal()}
        {renderProfileModal()}
        {renderShareProfilePicker()}
        {/* Caméra in-app pour photo snap (native) */}
        <InAppCamera
          visible={showSnapCamera}
          mode="photo"
          onClose={() => setShowSnapCamera(false)}
          onCapture={(asset) => {
            setShowSnapCamera(false);
            if (asset?.uri) sendPhotoMessageFromUri(asset.uri);
          }}
        />
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

      <SafeAreaView style={{ flex: 1 }} edges={[]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.textPri }]}>Chat</Text>
          <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); setShowSearch(true); }} hitSlop={10} style={styles.headerSearchBtn}>
            <Feather name="user-plus" size={22} color={theme.textPri} />
          </TouchableOpacity>
        </View>

        {/* Filtre local — filtre instantanément les contacts existants */}
        <View style={styles.searchBarWrap}>
          <View style={[styles.searchBarInner, { backgroundColor: theme.card }]}>
            <Feather name="search" size={16} color={theme.textSub} />
            <TextInput
              style={[styles.searchBarInput, { color: theme.textPri }]}
              placeholder="Filtrer mes contacts..."
              placeholderTextColor={theme.textSub}
              value={localFilter}
              onChangeText={setLocalFilter}
            />
            {localFilter.length > 0 && (
              <TouchableOpacity onPress={() => setLocalFilter('')} hitSlop={8}>
                <Feather name="x" size={16} color={theme.textSub} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Modal recherche globale (loupe) */}
        <Modal visible={showSearch} transparent animationType="slide" onRequestClose={() => setShowSearch(false)}>
          <View style={styles.globalSearchOverlay}>
            <View style={[styles.globalSearchSheet, { backgroundColor: theme.card }]}>
              <View style={[styles.settingsHandle, { backgroundColor: theme.border }]} />
              <Text style={[styles.globalSearchTitle, { color: theme.textPri }]}>Trouver un utilisateur</Text>
              <View style={[styles.searchBarInner, { backgroundColor: theme.bg, marginBottom: 4 }]}>
                <Feather name="search" size={16} color={theme.textSub} />
                <TextInput
                  style={[styles.searchBarInput, { color: theme.textPri }]}
                  placeholder="Pseudo, prénom… (tolérant aux accents)"
                  placeholderTextColor={theme.textSub}
                  value={searchQuery}
                  onChangeText={searchUsers}
                  autoFocus
                />
              </View>
              <Text style={[styles.globalSearchHint, { color: theme.textSub }]}>
                Tape au moins 2 caractères — les accents et la casse sont ignorés
              </Text>
              <FlatList
                data={searchResults}
                keyExtractor={it => it.id}
                style={{ maxHeight: 360 }}
                keyboardShouldPersistTaps="handled"
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
                ListEmptyComponent={
                  searchQuery.length >= 2
                    ? <Text style={[styles.noResults, { color: theme.textSub }]}>Aucun résultat pour « {searchQuery} »</Text>
                    : null
                }
                contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4 }}
              />
              <TouchableOpacity
                style={[styles.storyModalCancel, { backgroundColor: theme.border, margin: 16, marginTop: 8, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }]}
                onPress={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
              >
                <Text style={[styles.storyModalCancelText, { color: theme.textPri }]}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <FlatList
            data={localFilter.trim()
              ? sortedFriends.filter(f => f.username?.toLowerCase().includes(localFilter.toLowerCase()))
              : sortedFriends}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            initialNumToRender={10}
            maxToRenderPerBatch={8}
            windowSize={5}
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
                      const friendStory = storiesByUserId.get(friend.id);
                      const friendLc = getLogoConfig(friend.active_logo);
                      return (
                        <TouchableOpacity key={friend.id} style={styles.storyItem} onPress={() => friendStory && setStoryViewer({ visible: true, story: friendStory })}>
                          <GradientAvatar
                            uri={friend.avatar_url}
                            initial={friend.username?.[0]?.toUpperCase()}
                            size={58}
                            colors={friendLc.frameBorderColor ? [friendLc.frameBorderColor, friendLc.frameBorderColor] : ['#ED93B1', '#FF4567']}
                            theme={theme}
                            hasStory={!!friendStory}
                            badgeEmoji={friendLc.badge}
                          />
                          <Text style={[styles.storyName, { color: theme.textSub }]} numberOfLines={1}>{friend.username}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </>
            }
            renderItem={renderConversationItem}
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
      </SafeAreaView>

      {/* FAB : ouvre la recherche globale */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.accent, bottom: insets.bottom + 86 }]}
        onPress={() => { setSearchQuery(''); setSearchResults([]); setShowSearch(true); }}
        activeOpacity={0.85}
      >
        <Feather name="user-plus" size={20} color="#fff" />
      </TouchableOpacity>
      {renderProfileModal()}
      {renderShareProfilePicker()}
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
  statusBadge: {
    position: 'absolute',
    borderRadius: 10,
    borderWidth: 1.5,
    paddingHorizontal: 2,
    paddingVertical: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  backBtn:         { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chatHeaderInfo:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatUsername:    { fontWeight: '700', fontSize: 15 },
  chatStreak:      { fontSize: 11, fontWeight: '600', marginTop: 1 },
  typingRow:       { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  photoMsgBtn:     { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
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
  snapNotesRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 4 },
  snapNoteGlobal:  { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  snapNoteGlobalText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  snapNoteChip:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth },
  snapNoteLabel:   { fontSize: 10.5, fontWeight: '600' },
  snapNoteScore:   { fontSize: 12, fontWeight: '800' },
  msgTime:         { fontSize: 10 },
  msgMetaRow:      { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  likeBadge:       { position: 'absolute', bottom: -9, borderRadius: 11, paddingHorizontal: 3, paddingVertical: 1 },
  likeBadgeLeft:   { left: -6 },
  likeBadgeRight:  { right: -6 },
  likeBadgeText:   { fontSize: 13 },
  inputBar:        { flexDirection: 'column', borderTopWidth: StyleSheet.hairlineWidth },
  inputRow:        { flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 8 },
  msgInput:        { flex: 1, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, maxHeight: 100, borderWidth: 1 },
  sendBtn:         { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  micBtn:          { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  audioMsgRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 150, paddingVertical: 2 },
  audioPlayCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  audioWaveform:   { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  audioBar:        { width: 3, borderRadius: 2, minHeight: 3 },
  audioLabel:      { fontSize: 13 },

  /* Reply bar & quote */
  replyBar:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderLeftWidth: 3, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  replyBarSender:  { fontSize: 12, fontWeight: '700', marginBottom: 1 },
  replyBarText:    { fontSize: 12 },
  replyQuote:      { borderLeftWidth: 3, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 6 },
  replyQuoteSender:{ fontSize: 11, fontWeight: '700', marginBottom: 2 },
  replyQuoteText:  { fontSize: 12 },
  swipeableBubbleWrap: { maxWidth: '78%' },

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
  profileShareBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9, marginTop: 4 },
  profileShareBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  /* Partage profil picker */
  sharePickerSheet:    { width: '100%', borderRadius: 24, borderWidth: 1, padding: 20, paddingBottom: 28 },
  sharePickerTitle:    { fontWeight: '800', fontSize: 17, textAlign: 'center', marginBottom: 4 },
  sharePickerSub:      { fontSize: 12, textAlign: 'center', marginBottom: 14 },
  sharePickerRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  sharePickerName:     { fontWeight: '600', fontSize: 15, flex: 1 },

  /* Carte profil dans bulle de message */
  profileCardMsg:  { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, padding: 10, minWidth: 180 },
  profileCardName: { fontWeight: '700', fontSize: 14 },
  profileCardSub:  { fontSize: 12, marginTop: 2 },

  /* Recherche globale */
  globalSearchOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  globalSearchSheet:   { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 8, maxHeight: '85%' },
  globalSearchTitle:   { fontWeight: '800', fontSize: 18, marginBottom: 12, textAlign: 'center' },
  globalSearchHint:    { fontSize: 11, marginBottom: 8, textAlign: 'center' },

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
