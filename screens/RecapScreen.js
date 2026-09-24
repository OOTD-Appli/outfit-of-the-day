import { useState, useCallback, useEffect, useRef, memo } from 'react';
import { computeLevelInfo } from '../lib/utils';
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, Animated,
  FlatList, ActivityIndicator, TextInput, ScrollView, PanResponder,
  useWindowDimensions, Modal, Alert, Platform,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';
import Skeleton from '../components/Skeleton';
import AnimatedEntrance from '../components/AnimatedEntrance';
import Bouncy from '../components/Bouncy';
import { getLogoConfig } from '../lib/logoConfig';
import { isPwaStandalone, promptInstall } from '../lib/pwa';
import { downloadImageToDevice } from '../lib/downloadImage';
import { resolveTier, isPersonaUnlocked, tierLabel, PERSONA_TIER } from '../lib/tier';

// Mapping notes : la DB stocke score_couleurs=harmonie, score_coupe=fit, score_tendance=détails.
const NOTE_BADGES = [
  { key: 'score_coupe',    label: 'Fit',      icon: 'shirt-outline',         color: '#ED93B1' },
  { key: 'score_couleurs', label: 'Harmonie', icon: 'color-palette-outline', color: '#B0809A' },
  { key: 'score_tendance', label: 'Détails',  icon: 'sparkles-outline',      color: '#C9A47A' },
];

// Clés strictement synchronisées avec supabase/functions/analyze-outfit (PERSONALITIES)
// et lib/tier.js (PERSONA_TIER). Ordre = du plus accessible au plus exclusif.
const PERSONALITIES = [
  { key: 'coach',        emoji: '🎯', label: 'Coach mode motivant',  desc: 'Constructif, orienté progression' },
  { key: 'bienveillant', emoji: '🌸', label: 'Styliste bienveillant', desc: 'Douce, encourageante, positive' },
  { key: 'pote_hype',    emoji: '💅', label: 'Meilleure pote hype',   desc: 'Fun, complice, énergique' },
  { key: 'fashion_week', emoji: '🔥', label: 'Critique fashion week', desc: 'Exigeante, sans complaisance' },
  { key: 'streetwear',   emoji: '🖤', label: 'Icône streetwear',     desc: 'Culture urbaine, audace, tendances' },
];

function fmtNote(value) {
  if (typeof value !== 'number') return '–';
  return Number.isInteger(value) ? `${value}` : value.toFixed(1).replace('.', ',');
}

function DarkLightToggle({ isDark, onToggle, accent }) {
  const anim = useRef(new Animated.Value(isDark ? 1 : 0)).current;
  const prevIsDark = useRef(isDark);

  useEffect(() => {
    if (prevIsDark.current === isDark) return;
    prevIsDark.current = isDark;
    Animated.spring(anim, {
      toValue: isDark ? 1 : 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 5,
    }).start();
  }, [isDark, anim]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [3, 27] });

  return (
    <TouchableOpacity onPress={onToggle} activeOpacity={0.85}>
      <View style={{ width: 54, height: 30, borderRadius: 15, overflow: 'hidden' }}>
        <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#888', borderRadius: 15 }} />
        <Animated.View style={{
          ...StyleSheet.absoluteFillObject,
          backgroundColor: accent,
          borderRadius: 15,
          opacity: anim,
        }} />
        <Animated.View style={{
          position: 'absolute',
          top: 3,
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: '#fff',
          elevation: 3,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 3,
          transform: [{ translateX }],
        }} />
      </View>
    </TouchableOpacity>
  );
}

// Mémoïsé : évite de re-rendre toute la grille (photos + animations d'entrée)
// quand un state sans rapport change ailleurs dans l'écran (settings, avatar upload...).
//
// scrollSnapAlign/scrollSnapStop (web uniquement, ignorées sans effet sur natif) :
// pagingEnabled seul s'est déjà révélé peu fiable sur react-native-web (voir
// Post-mortem "Feed — swipe cassé sur web", TACHES.md 2026-08-15) — un swipe
// franc pouvait sauter plusieurs pages au lieu de s'arrêter net sur la
// suivante. Même fix que FeedScreen (CSS scroll-snap natif), version
// horizontale ici (voir styles.lbListWeb sur le FlatList parent).
const LightboxPage = memo(function LightboxPage({ item, ww, wh }) {
  return (
    <View style={[styles.lbPage, { width: ww, height: wh }, Platform.OS === 'web' && styles.lbPageWeb]}>
      <ExpoImage source={{ uri: item.image_url }} style={{ width: ww, height: wh }} contentFit="contain" />
    </View>
  );
});

const GridItem = memo(function GridItem({ item, index, onPress }) {
  return (
    <AnimatedEntrance style={styles.gridCell} delay={Math.min(index, 12) * 30} distance={10} scaleFrom={0.92}>
      <TouchableOpacity style={{ width: '100%', height: '100%' }} activeOpacity={0.85} onPress={() => onPress(index)}>
        <ExpoImage source={{ uri: item.image_url }} style={styles.gridPhoto} contentFit="cover" recyclingKey={item.id} />
      </TouchableOpacity>
    </AnimatedEntrance>
  );
});

export default function RecapScreen() {
  const navigation = useNavigation();
  const [profile, setProfile] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [ootds, setOotds] = useState([]);
  const [graphRange, setGraphRange] = useState(30); // 7 ou 30 jours — graphique perso "Mon évolution"
  const [loading, setLoading] = useState(true);
  const { width: ww, height: wh } = useWindowDimensions();
  const avatarSize = Math.min(Math.round(ww * 0.22), 90);
  // Cellules carrées (aspectRatio:1, largeur 33.33%) → hauteur de ligne déductible de ww.
  const gridRowH = ww / 3;
  const getGridItemLayout = useCallback((_, index) => {
    const row = Math.floor(index / 3);
    return { length: gridRowH, offset: row * gridRowH, index };
  }, [gridRowH]);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const { showToast } = useToast();
  const { theme, colorMode, setColorMode } = useTheme();
  const insets = useSafeAreaInsets();
  const [lightbox, setLightbox] = useState({ visible: false, index: 0 });
  // Fermeture par swipe vers le bas (lightbox) : translateY/opacity animés au
  // fil du doigt, capturés uniquement sur un geste nettement vertical et vers
  // le bas — un geste horizontal reste entièrement dévolu au FlatList de
  // pagination (voir onMoveShouldSetPanResponderCapture ci-dessous, même
  // logique d'axe que le viewer plein écran de CompetitionScreen).
  const lbTranslateY = useRef(new Animated.Value(0)).current;
  const lbOpacity = useRef(new Animated.Value(1)).current;
  const [downloading, setDownloading] = useState(false);
  const [loadingMoreOotds, setLoadingMoreOotds] = useState(false);
  const ootdsPageRef = useRef(0);
  const ootdsHasMoreRef = useRef(true);
  const OOTDS_PAGE = 21; // multiple de 3 pour la grille
  const [showHistoryLock, setShowHistoryLock] = useState(false);
  const [installable, setInstallable] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setAvatarLoadError(false);
  }, [profile]);

  // Bouton « Télécharger l'application » : affiché dès qu'on est sur le web et que
  // l'app n'est pas déjà installée (standalone) — indépendamment de beforeinstallprompt.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const update = () => setInstallable(!isPwaStandalone());
    update();
    window.addEventListener('ootd-pwa-change', update);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('ootd-pwa-change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const fetchProfil = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProfile(null);
        setOotds([]);
        return;
      }

      ootdsPageRef.current = 0;
      ootdsHasMoreRef.current = true;
      // 3 requêtes indépendantes (toutes filtrées sur user.id) → lancées en parallèle.
      const [{ data: profileData }, { data: ootdsData }, { data: subData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, username, avatar_url, active_logo, bio, is_private, points, niveau, style_stats, specialized_feed, analysis_personality, has_analysis_pass, has_ootd_plus_pass')
          .eq('id', user.id)
          .single(),
        supabase
          .from('ootds')
          .select('id, image_url, score_global, score_couleurs, score_coupe, score_tendance, score_scale, conseil, caption, styles, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .range(0, OOTDS_PAGE - 1),
        supabase
          .from('subscriptions')
          .select('status, plan_type')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      setProfile(profileData);
      setOotds(ootdsData || []);
      // Historique complet = perk Plus/Elite (Cahier des charges Monétisation 2026-08-12).
      // Gratuit : plafonné à la 1ère page (21 tenues les plus récentes), pas de pagination
      // au-delà — évite un appel réseau inutile à chaque scroll pour ce tier.
      const moreExists = (ootdsData || []).length === OOTDS_PAGE;
      const freshTier = resolveTier({
        subscription: subData,
        hasPlus: profileData?.has_ootd_plus_pass,
        hasAnalysis: profileData?.has_analysis_pass,
      });
      ootdsHasMoreRef.current = moreExists && freshTier !== 'free';
      setShowHistoryLock(moreExists && freshTier === 'free');
      ootdsPageRef.current = 1;
      setSubscription(subData);
      setUserEmail(user.email || '');
      setEditUsername(profileData?.username || '');
      setEditBio(profileData?.bio || '');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMoreOotds = useCallback(async () => {
    if (loadingMoreOotds || !ootdsHasMoreRef.current || !profile?.id) return;
    setLoadingMoreOotds(true);
    const start = ootdsPageRef.current * OOTDS_PAGE;
    const { data } = await supabase
      .from('ootds')
      .select('id, image_url, score_global, score_couleurs, score_coupe, score_tendance, score_scale, conseil, caption, styles, created_at')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .range(start, start + OOTDS_PAGE - 1);
    if (data?.length) {
      setOotds(prev => [...prev, ...data]);
      ootdsHasMoreRef.current = data.length === OOTDS_PAGE;
      ootdsPageRef.current += 1;
    } else {
      ootdsHasMoreRef.current = false;
    }
    setLoadingMoreOotds(false);
  }, [loadingMoreOotds, profile?.id]);

  useFocusEffect(
    useCallback(() => {
      fetchProfil();
    }, [fetchProfil])
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleInstall = async () => {
    const ok = await promptInstall();
    if (ok) { setInstallable(false); return; }
    // Pas de prompt natif disponible (Safari iOS, ou prompt déjà consommé)
    const msg = "Pour installer l'application, ouvre le menu de partage de ton navigateur puis « Sur l'écran d'accueil ».";
    if (typeof window !== 'undefined' && window.alert) window.alert(msg);
    else showToast(msg, { type: 'info' });
  };

  const openSettings = () => {
    setEditUsername(profile?.username || '');
    setEditBio(profile?.bio || '');
    setSettingsVisible(true);
  };

  const saveSettings = async () => {
    const trimUser = editUsername.trim();
    const trimBio = editBio.trim();
    if (!trimUser) { showToast('Le nom ne peut pas être vide', { type: 'warning' }); return; }
    setSavingSettings(true);
    const { error } = await supabase.from('profiles')
      .update({ username: trimUser, bio: trimBio || null })
      .eq('id', profile.id);
    if (error) {
      showToast(error.code === '23505' ? 'Ce nom est déjà pris' : (error.message || 'Erreur'), { type: 'error' });
    } else {
      setProfile(prev => ({ ...prev, username: trimUser, bio: trimBio || null }));
      setSettingsVisible(false);
      showToast('Profil mis à jour ✓', { type: 'success' });
    }
    setSavingSettings(false);
  };

  const togglePrivacy = async () => {
    const newVal = !profile?.is_private;
    setProfile(prev => ({ ...prev, is_private: newVal }));
    const { error } = await supabase.from('profiles').update({ is_private: newVal }).eq('id', profile.id);
    if (error) {
      setProfile(prev => ({ ...prev, is_private: !newVal }));
      showToast('Erreur mise à jour confidentialité', { type: 'error' });
    }
  };

  const toggleSpecializedFeed = async () => {
    const newVal = !profile?.specialized_feed;
    setProfile(prev => ({ ...prev, specialized_feed: newVal }));
    const { error } = await supabase.from('profiles').update({ specialized_feed: newVal }).eq('id', profile.id);
    if (error) {
      setProfile(prev => ({ ...prev, specialized_feed: !newVal }));
      showToast('Erreur mise à jour', { type: 'error' });
    }
  };

  const changePersonality = async (key, unlocked) => {
    if (!unlocked) { navigation.navigate('Shop'); return; }
    const prevKey = profile?.analysis_personality || 'coach';
    if (prevKey === key) return;
    setProfile(prev => ({ ...prev, analysis_personality: key }));
    const { error } = await supabase.from('profiles').update({ analysis_personality: key }).eq('id', profile.id);
    if (error) {
      setProfile(prev => ({ ...prev, analysis_personality: prevKey }));
      showToast('Erreur mise à jour', { type: 'error' });
    }
  };

  const openLightbox = useCallback((index) => {
    lbTranslateY.setValue(0);
    lbOpacity.setValue(1);
    setLightbox({ visible: true, index });
  }, [lbTranslateY, lbOpacity]);
  const closeLightbox = () => setLightbox({ visible: false, index: 0 });

  const lbPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => false,
      // Ne capture le geste (et ne bloque donc le FlatList horizontal) que si
      // le mouvement est nettement vertical vers le bas — un swipe horizontal,
      // même léger, reste prioritaire pour changer de photo.
      onMoveShouldSetPanResponderCapture: (_, g) => g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderMove: (_, g) => {
        if (g.dy <= 0) return;
        lbTranslateY.setValue(g.dy);
        lbOpacity.setValue(Math.max(0.3, 1 - g.dy / 400));
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 120 || g.vy > 0.8) {
          // 1000px de marge : toujours largement hors-écran, peu importe la
          // hauteur réelle — évite de dépendre de `wh` capturé une seule fois
          // dans la fermeture de useRef(PanResponder.create(...)).
          Animated.timing(lbTranslateY, { toValue: 1000, duration: 200, useNativeDriver: true }).start(closeLightbox);
        } else {
          Animated.spring(lbTranslateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
          Animated.timing(lbOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(lbTranslateY, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        Animated.timing(lbOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      },
    })
  ).current;
  const renderGridItem = useCallback(({ item, index }) => (
    <GridItem item={item} index={index} onPress={openLightbox} />
  ), [openLightbox]);
  const renderLightboxItem = useCallback(({ item }) => (
    <LightboxPage item={item} ww={ww} wh={wh} />
  ), [ww, wh]);

  const handleDownload = async (item) => {
    if (!item?.image_url || downloading) return;
    setDownloading(true);
    const res = await downloadImageToDevice(item.image_url, `ootd_${item.id}`);
    setDownloading(false);
    if (res.ok) {
      showToast(Platform.OS === 'web' ? 'Téléchargement lancé' : 'Photo enregistrée dans ta galerie 📸', { type: 'success' });
    } else if (res.reason === 'permission') {
      showToast('Autorise l\'accès aux photos pour enregistrer', { type: 'warning' });
    } else {
      showToast('Téléchargement impossible', { type: 'error' });
    }
  };

  // Suppression effective : ligne `ootds` (→ disparaît du feed et du profil) + fichier Storage
  const doDeleteOotd = async (item) => {
    try {
      const { error } = await supabase.from('ootds').delete().eq('id', item.id);
      if (error) throw error;
      // Nettoyage du fichier image dans le Storage (best-effort)
      try {
        const marker = '/storage/v1/object/public/';
        const idx = (item.image_url || '').indexOf(marker);
        if (idx !== -1) {
          const rest = item.image_url.slice(idx + marker.length);
          const bucket = rest.split('/')[0];
          const path = rest.split('/').slice(1).join('/');
          if (bucket && path) await supabase.storage.from(bucket).remove([decodeURIComponent(path)]);
        }
      } catch (storageErr) {
        console.error('[deleteOotd] storage cleanup', storageErr);
      }
      setOotds((prev) => prev.filter((o) => o.id !== item.id));
      closeLightbox();
      showToast('Outfit supprimé', { type: 'success' });
      fetchProfil(); // resync (le feed se rafraîchit aussi à son focus)
    } catch (e) {
      console.error('[deleteOotd] suppression échouée (RLS / requête ?) :', e);
      showToast(e.message || 'Suppression impossible', { type: 'error' });
    }
  };

  // Confirmation : Alert.alert n'a pas de boutons sur react-native-web → window.confirm
  const deleteOotd = (item) => {
    if (!item) return;
    if (Platform.OS === 'web') {
      const ok = typeof window !== 'undefined' && window.confirm
        ? window.confirm('Voulez-vous vraiment supprimer cet outfit ?')
        : true;
      if (ok) doDeleteOotd(item);
      return;
    }
    Alert.alert(
      'Supprimer',
      'Voulez-vous vraiment supprimer cet outfit ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => doDeleteOotd(item) },
      ],
    );
  };

  const changeAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast('Permission refusée pour accéder à la galerie', { type: 'warning' });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled) return;

    setUploadingAvatar(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const fileName = `${user.id}/avatar.jpg`;

      const photoResponse = await fetch(result.assets[0].uri);
      const blob = await photoResponse.blob();

      await supabase.storage
        .from('avatars')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      await supabase
        .from('profiles')
        .update({ avatar_url: urlData.publicUrl })
        .eq('id', user.id);

      await fetchProfil();
      showToast('Photo de profil mise à jour !', { type: 'success' });
    } catch (e) {
      showToast('Erreur : ' + e.message, { type: 'error' });
    }
    setUploadingAvatar(false);
  };

  // Normalise chaque tenue sur 100 avant de moyenner : les tenues antérieures
  // au prompt IA v3 (score_scale=10) ne doivent pas fausser la moyenne face
  // aux nouvelles notées sur 100.
  const moyenneScore = ootds.length > 0
    ? Math.round(
        ootds.reduce((acc, o) => acc + (o.score_global / (o.score_scale || 100)) * 100, 0) / ootds.length,
      )
    : '-';

  // Graphique perso "Mon évolution" : dérivé du state `ootds` déjà chargé (jusqu'à 21 tenues
  // les plus récentes), pas de requête réseau dédiée. Peut donc ne pas couvrir 30 jours pleins
  // si l'utilisateur publie plus de 21 fois sur la période — acceptable pour cette V1.
  // Même normalisation 0-100 que moyenneScore ci-dessus, pour ne pas mélanger les échelles
  // historiques (score_scale=10 vs 100).
  const graphWidth = Math.max(0, ww - 64); // largeur carte (marge 16 + padding 16 de chaque côté)
  const graphHeight = 120;
  const graphData = (() => {
    const now = Date.now();
    const rangeMs = graphRange * 24 * 60 * 60 * 1000;
    return ootds
      .filter(o => o.created_at && now - new Date(o.created_at).getTime() <= rangeMs)
      .map(o => ({
        date: new Date(o.created_at).getTime(),
        score: (o.score_global / (o.score_scale || 100)) * 100,
      }))
      .sort((a, b) => a.date - b.date);
  })();
  const graphPoints = (() => {
    if (graphData.length < 2) return [];
    const minDate = graphData[0].date;
    const maxDate = graphData[graphData.length - 1].date;
    const span = maxDate - minDate || 1;
    return graphData.map(d => ({
      x: ((d.date - minDate) / span) * graphWidth,
      y: graphHeight - (Math.max(0, Math.min(100, d.score)) / 100) * graphHeight,
    }));
  })();

  const levelInfo = computeLevelInfo(profile?.points || 0);
  const logoConfig = getLogoConfig(profile?.active_logo);
  const subActive = subscription && ['active', 'trialing'].includes(subscription.status);
  const premiumLabel = subActive
    ? (subscription.plan_type === 'elite' ? '💎 Elite' : '⭐ Plus')
    : null;
  const tier = resolveTier({
    subscription,
    hasPlus: profile?.has_ootd_plus_pass,
    hasAnalysis: profile?.has_analysis_pass,
  });

  if (loading) return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]} edges={[]}>
      <View style={styles.skeletonHeader}>
        <Skeleton width={120} height={22} borderRadius={6} />
        <Skeleton width={90} height={14} borderRadius={6} style={{ marginTop: 8 }} />
      </View>
      <View style={styles.skeletonCard}>
        <Skeleton width={avatarSize} height={avatarSize} borderRadius={avatarSize / 2} />
        <Skeleton width={140} height={18} borderRadius={6} style={{ marginTop: 12 }} />
        <View style={[styles.skeletonStats, { backgroundColor: theme.card }]}>
          {[0, 1, 2].map(i => <Skeleton key={i} width={60} height={30} borderRadius={6} />)}
        </View>
      </View>
      <View style={styles.skeletonGrid}>
        {Array.from({ length: 9 }).map((_, i) => (
          <Skeleton key={i} width="32%" height={0} style={{ aspectRatio: 1 }} borderRadius={0} />
        ))}
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]} edges={[]}>
      <FlatList
        data={ootds}
        keyExtractor={item => item.id}
        numColumns={3}
        initialNumToRender={21}
        maxToRenderPerBatch={12}
        windowSize={5}
        onEndReached={loadMoreOotds}
        onEndReachedThreshold={0.3}
        getItemLayout={getGridItemLayout}
        ListFooterComponent={loadingMoreOotds ? (
          <ActivityIndicator color={theme.accent} style={{ padding: 16 }} />
        ) : showHistoryLock ? (
          <TouchableOpacity
            style={[styles.historyLockCard, { backgroundColor: theme.card, borderColor: theme.border }]}
            onPress={() => navigation.navigate('Shop')}
            activeOpacity={0.85}
          >
            <Ionicons name="lock-closed" size={18} color={theme.accent} />
            <Text style={[styles.historyLockText, { color: theme.textPri }]}>
              Débloque l'historique complet de tes tenues avec OOTD Plus
            </Text>
            <Text style={[styles.historyLockCta, { color: theme.accent }]}>Voir les offres →</Text>
          </TouchableOpacity>
        ) : null}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <View>
                <Text style={[styles.title, { color: theme.textPri }]}>Récap</Text>
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity
                  style={[styles.logoutBtn, { borderColor: theme.accent, backgroundColor: theme.accent + '14' }]}
                  onPress={handleLogout}
                  activeOpacity={0.85}
                >
                  <Ionicons name="log-out-outline" size={16} color={theme.accent} />
                  <Text style={[styles.logoutText, { color: theme.accent }]}>Se déconnecter</Text>
                </TouchableOpacity>
                {installable && (
                  <TouchableOpacity
                    style={[styles.installBtn, { backgroundColor: theme.accent }]}
                    onPress={handleInstall}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="download-outline" size={15} color="#fff" />
                    <Text style={styles.installBtnText}>Télécharger l'application</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            <AnimatedEntrance style={styles.profileCard} distance={16} duration={380}>
              <View style={styles.avatarContainer}>
                {uploadingAvatar ? (
                  <View style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: theme.accent, borderWidth: logoConfig.frameBorderColor ? 3 : 0, borderColor: logoConfig.frameBorderColor || 'transparent' }]}>
                    <ActivityIndicator color="#3a0d1e" />
                  </View>
                ) : profile?.avatar_url && !avatarLoadError ? (
                  <ExpoImage
                    source={{ uri: profile.avatar_url + '?t=' + new Date().getTime() }}
                    style={[styles.avatarImg, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: theme.accent, borderWidth: logoConfig.frameBorderColor ? 3 : 0, borderColor: logoConfig.frameBorderColor || 'transparent' }]}
                    contentFit="cover"
                    onError={() => setAvatarLoadError(true)}
                  />
                ) : (
                  <View style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: theme.accent, borderWidth: logoConfig.frameBorderColor ? 3 : 0, borderColor: logoConfig.frameBorderColor || 'transparent' }]}>
                    <Text style={[styles.avatarText, { fontSize: Math.round(avatarSize * 0.38) }]}>
                      {profile?.username?.[0]?.toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.usernameRow}>
                <Text style={[styles.username, { color: theme.textPri }]}>{profile?.username || 'Anonyme'}</Text>
                {logoConfig.badge && <Text style={styles.usernameBadge}>{logoConfig.badge}</Text>}
              </View>
              {premiumLabel && (
                <View style={[styles.premiumBadge, { backgroundColor: theme.accent + '1A', borderColor: theme.accent }]}>
                  <Text style={[styles.premiumBadgeText, { color: theme.accent }]}>{premiumLabel}</Text>
                </View>
              )}

              <View style={[styles.stats, { backgroundColor: theme.card }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: theme.accent }]}>{ootds.length}</Text>
                  <Text style={[styles.statLabel, { color: theme.textSub }]}>Tenues</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: theme.accent }]}>{moyenneScore}</Text>
                  <Text style={[styles.statLabel, { color: theme.textSub }]}>Score moyen</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: theme.accent }]}>{profile?.points || 0}</Text>
                  <Text style={[styles.statLabel, { color: theme.textSub }]}>Points</Text>
                </View>
              </View>

              {/* Top 3 styles */}
              {(() => {
                const top3 = Object.entries(profile?.style_stats || {})
                  .sort(([, a], [, b]) => Number(b) - Number(a))
                  .slice(0, 3)
                  .map(([style]) => style);
                if (!top3.length) return null;
                return (
                  <View style={styles.stylesRow}>
                    {top3.map(style => (
                      <View key={style} style={[styles.styleChip, { backgroundColor: theme.accent + '18', borderColor: theme.accent + '55' }]}>
                        <Text style={[styles.styleChipText, { color: theme.accent }]}>{style}</Text>
                      </View>
                    ))}
                  </View>
                );
              })()}
            </AnimatedEntrance>

            <View style={[styles.niveauCard, { backgroundColor: theme.card }]}>
              <Text style={[styles.niveauLabel, { color: theme.textPri }]}>Niveau {profile?.niveau || 1}</Text>
              <View style={[styles.niveauBar, { backgroundColor: theme.border }]}>
                <View style={[styles.niveauFill, { width: `${levelInfo.percent}%`, backgroundColor: theme.accent }]} />
              </View>
              <Text style={[styles.niveauSub, { color: theme.textSub }]}>{levelInfo.progressInLevel} / {levelInfo.threshold} points pour le prochain niveau</Text>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: theme.accent, backgroundColor: theme.accent + '14' }]}
                onPress={openSettings}
                activeOpacity={0.85}
              >
                <Ionicons name="settings-outline" size={16} color={theme.accent} />
                <Text style={[styles.actionBtnText, { color: theme.accent }]}>Réglages</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: theme.accent, backgroundColor: theme.accent + '14' }]}
                onPress={() => navigation.navigate('Shop')}
                activeOpacity={0.85}
              >
                <Ionicons name="star-outline" size={16} color={theme.accent} />
                <Text style={[styles.actionBtnText, { color: theme.accent }]}>Abonnement</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: theme.accent, backgroundColor: theme.accent + '14' }]}
                onPress={() => navigation.navigate('Friends')}
                activeOpacity={0.85}
              >
                <Ionicons name="people-outline" size={16} color={theme.accent} />
                <Text style={[styles.actionBtnText, { color: theme.accent }]}>Mes amis</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.graphCard, { backgroundColor: theme.card }]}>
              <View style={styles.graphHeaderRow}>
                <Text style={[styles.graphTitle, { color: theme.textPri }]}>Mon évolution</Text>
                <View style={styles.graphSegmentRow}>
                  <TouchableOpacity
                    style={[
                      styles.graphSegmentBtn,
                      { borderColor: theme.accent },
                      graphRange === 7 && { backgroundColor: theme.accent },
                    ]}
                    onPress={() => setGraphRange(7)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.graphSegmentText, { color: graphRange === 7 ? '#fff' : theme.accent }]}>7 jours</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.graphSegmentBtn,
                      { borderColor: theme.accent },
                      graphRange === 30 && { backgroundColor: theme.accent },
                    ]}
                    onPress={() => setGraphRange(30)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.graphSegmentText, { color: graphRange === 30 ? '#fff' : theme.accent }]}>30 jours</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {graphPoints.length < 2 ? (
                <Text style={[styles.graphEmptyText, { color: theme.textSub }]}>
                  Pas encore assez de données pour un graphique.
                </Text>
              ) : (
                <Svg width={graphWidth} height={graphHeight}>
                  <Polyline
                    points={graphPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={theme.accent}
                    strokeWidth={2}
                  />
                  {graphPoints.map((p, i) => (
                    <Circle key={i} cx={p.x} cy={p.y} r={3.5} fill={theme.accent} />
                  ))}
                </Svg>
              )}
            </View>

            <Text style={[styles.galerieTitle, { color: theme.textPri }]}>Mes tenues</Text>
          </View>
        }
        renderItem={renderGridItem}
        ListEmptyComponent={
          <View style={styles.emptyGalerie}>
            <Text style={[styles.emptyText, { color: theme.textPri }]}>Aucune tenue pour l'instant</Text>
            <Text style={[styles.emptySub, { color: theme.textSub }]}>Analyse ta première tenue !</Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />

      {/* Modal Paramètres */}
      <Modal visible={settingsVisible} transparent animationType="slide" onRequestClose={() => setSettingsVisible(false)}>
        <View style={styles.settingsOverlay}>
          <View style={[styles.settingsSheet, { backgroundColor: theme.card }]}>
            <View style={[styles.settingsHandle, { backgroundColor: theme.border }]} />
            <Text style={[styles.settingsTitle, { color: theme.textPri }]}>Paramètres du profil</Text>
            <ScrollView showsVerticalScrollIndicator={false}>

              {/* Photo */}
              <TouchableOpacity
                style={[styles.settingsPhotoRow, { borderColor: theme.border }]}
                onPress={() => { setSettingsVisible(false); setTimeout(changeAvatar, 350); }}
                activeOpacity={0.8}
              >
                {profile?.avatar_url ? (
                  <ExpoImage source={{ uri: profile.avatar_url }} style={styles.settingsAvatarThumb} contentFit="cover" />
                ) : (
                  <View style={[styles.settingsAvatarFallback, { backgroundColor: theme.accent }]}>
                    <Text style={{ color: '#fff', fontWeight: '700' }}>{profile?.username?.[0]?.toUpperCase()}</Text>
                  </View>
                )}
                <Text style={[styles.settingsFieldValue, { color: theme.textPri, flex: 1 }]}>Changer la photo</Text>
                <Ionicons name="chevron-forward" size={18} color={theme.textSub} />
              </TouchableOpacity>

              {/* Username */}
              <Text style={[styles.settingsLabel, { color: theme.textSub }]}>Nom d'utilisateur</Text>
              <TextInput
                style={[styles.settingsInput, { backgroundColor: theme.bg, borderColor: theme.border, color: theme.textPri }]}
                value={editUsername}
                onChangeText={setEditUsername}
                placeholder="Ton pseudo"
                placeholderTextColor={theme.textSub}
                autoCapitalize="none"
                maxLength={30}
              />

              {/* Bio */}
              <Text style={[styles.settingsLabel, { color: theme.textSub }]}>Bio</Text>
              <TextInput
                style={[styles.settingsInput, styles.settingsInputMulti, { backgroundColor: theme.bg, borderColor: theme.border, color: theme.textPri }]}
                value={editBio}
                onChangeText={setEditBio}
                placeholder="Parle-nous de toi..."
                placeholderTextColor={theme.textSub}
                multiline
                maxLength={160}
              />

              {/* Email (lecture seule) */}
              <Text style={[styles.settingsLabel, { color: theme.textSub }]}>E-mail</Text>
              <View style={[styles.settingsReadOnly, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                <Text style={[styles.settingsFieldValue, { color: theme.textSub }]}>{userEmail || '—'}</Text>
                <Ionicons name="lock-closed-outline" size={14} color={theme.textSub} />
              </View>

              {/* Confidentialité */}
              <Text style={[styles.settingsLabel, { color: theme.textSub }]}>Confidentialité</Text>
              <View style={[styles.settingsPrivacyRow, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                <Text style={[styles.settingsFieldValue, { flex: 1, color: theme.textPri }]}>
                  {profile?.is_private ? '🔒 Compte privé' : '🌍 Compte public'}
                </Text>
                <Switch
                  value={!!profile?.is_private}
                  onValueChange={togglePrivacy}
                  trackColor={{ false: '#ddd', true: theme.accent + '88' }}
                  thumbColor={profile?.is_private ? theme.accent : '#f4f3f4'}
                />
              </View>

              {/* Flux spécialisé */}
              <Text style={[styles.settingsLabel, { color: theme.textSub }]}>Contenu</Text>
              <View style={[styles.settingsPrivacyRow, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.settingsFieldValue, { color: theme.textPri }]}>Contenu spécialisé</Text>
                  <Text style={{ fontSize: 11, color: theme.textSub, marginTop: 2 }}>
                    Priorise les styles qui te correspondent dans POUR TOI
                  </Text>
                </View>
                <Switch
                  value={!!profile?.specialized_feed}
                  onValueChange={toggleSpecializedFeed}
                  trackColor={{ false: '#ddd', true: theme.accent + '88' }}
                  thumbColor={profile?.specialized_feed ? theme.accent : '#f4f3f4'}
                />
              </View>

              {/* Apparence */}
              <Text style={[styles.settingsLabel, { color: theme.textSub }]}>Apparence</Text>
              <View style={[styles.settingsPrivacyRow, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Ionicons
                    name={colorMode === 'dark' ? 'moon-outline' : 'sunny-outline'}
                    size={18}
                    color={theme.textPri}
                  />
                  <Text style={[styles.settingsFieldValue, { color: theme.textPri }]}>
                    {colorMode === 'dark' ? 'Mode sombre' : 'Mode clair'}
                  </Text>
                </View>
                <DarkLightToggle
                  isDark={colorMode === 'dark'}
                  onToggle={() => setColorMode(colorMode === 'dark' ? 'light' : 'dark')}
                  accent={theme.accent}
                />
              </View>

              {/* Personnalité du critique IA */}
              <Text style={[styles.settingsLabel, { color: theme.textSub }]}>Personnalité du critique IA</Text>
              {PERSONALITIES.map(p => {
                const active = (profile?.analysis_personality || 'coach') === p.key;
                const unlocked = isPersonaUnlocked(p.key, tier);
                return (
                  <TouchableOpacity
                    key={p.key}
                    style={[
                      styles.settingsPrivacyRow,
                      { backgroundColor: theme.bg, borderColor: active ? theme.accent : theme.border, marginBottom: 8 },
                      active && { borderWidth: 2 },
                      !unlocked && { opacity: 0.5 },
                    ]}
                    onPress={() => changePersonality(p.key, unlocked)}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 20, marginRight: 10 }}>{p.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.settingsFieldValue, { color: theme.textPri }]}>{p.label}</Text>
                      <Text style={{ fontSize: 11, color: theme.textSub, marginTop: 2 }}>{p.desc}</Text>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={20} color={theme.accent} />
                    ) : !unlocked ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Ionicons name="lock-closed" size={14} color={theme.textSub} />
                        <Text style={{ fontSize: 11, fontWeight: '700', color: theme.textSub }}>
                          {tierLabel(PERSONA_TIER[p.key])}
                        </Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}

            </ScrollView>

            <View style={[styles.settingsBtnsRow, { borderTopColor: theme.border }]}>
              <TouchableOpacity style={[styles.settingsCancel, { backgroundColor: theme.border }]} onPress={() => setSettingsVisible(false)}>
                <Text style={[styles.settingsCancelText, { color: theme.textPri }]}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.settingsSave, { backgroundColor: theme.accent }, savingSettings && { opacity: 0.6 }]}
                onPress={saveSettings}
                disabled={savingSettings}
              >
                {savingSettings
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.settingsSaveText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Lightbox plein écran : épurée (image + 4 notes seulement), défilement
          horizontal page par page magnétique, swipe vers le bas pour fermer. */}
      <Modal visible={lightbox.visible} animationType="fade" onRequestClose={closeLightbox} statusBarTranslucent>
        <Animated.View
          style={[
            styles.lbContainer,
            { width: ww, height: wh, transform: [{ translateY: lbTranslateY }], opacity: lbOpacity },
          ]}
          {...lbPanResponder.panHandlers}
        >
          <FlatList
            data={ootds}
            horizontal
            pagingEnabled
            disableIntervalMomentum
            decelerationRate="fast"
            bounces={false}
            windowSize={3}
            maxToRenderPerBatch={2}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            initialScrollIndex={lightbox.index}
            getItemLayout={(_, i) => ({ length: ww, offset: ww * i, index: i })}
            onMomentumScrollEnd={(e) =>
              setLightbox((prev) => ({ ...prev, index: Math.round(e.nativeEvent.contentOffset.x / ww) }))
            }
            renderItem={renderLightboxItem}
            style={Platform.OS === 'web' ? styles.lbListWeb : undefined}
          />
          <SafeAreaView style={styles.lbBar} edges={['top']} pointerEvents="box-none">
            <TouchableOpacity style={styles.lbBtn} onPress={closeLightbox} activeOpacity={0.8}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <View style={styles.lbBarRight}>
              <TouchableOpacity
                style={styles.lbBtn}
                onPress={() => ootds[lightbox.index] && handleDownload(ootds[lightbox.index])}
                activeOpacity={0.8}
                disabled={downloading}
              >
                {downloading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Ionicons name="download-outline" size={24} color="#fff" />}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.lbBtn}
                onPress={() => ootds[lightbox.index] && deleteOotd(ootds[lightbox.index])}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          {/* Uniquement les 4 notes (score global + 3 sous-scores) — plus de
              date, description ni conseils IA dans la vue plein écran (demande
              explicite : interface minimaliste). Décoratif, ne capte aucun
              geste : pointerEvents="none" pour ne jamais gêner le swipe. */}
          {(() => {
            const cur = ootds[lightbox.index];
            if (!cur) return null;
            return (
              <View style={[styles.lbScoresWrap, { bottom: insets.bottom + 16 }]} pointerEvents="none">
                <View style={[styles.lbGlobalBadge, { backgroundColor: theme.accent }]}>
                  <Ionicons name="star" size={13} color="#fff" />
                  <Text style={styles.lbGlobalScore}>{fmtNote(cur.score_global)}</Text>
                  <Text style={styles.lbGlobalMax}>/{cur.score_scale || 100}</Text>
                </View>
                <View style={styles.lbSubScoresRow}>
                  {NOTE_BADGES.map(b => (
                    <View key={b.key} style={styles.lbSubBadge}>
                      <Ionicons name={b.icon} size={12} color={b.color} />
                      <Text style={[styles.lbSubBadgeScore, { color: b.color }]}>{fmtNote(cur[b.key])}</Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })()}
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1 },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 10 },
  title:          { fontSize: 24, fontWeight: '700' },
  logout:         { fontSize: 13 },
  list:           { paddingBottom: 40 },

  headerActions:  { flexDirection: 'column', alignItems: 'flex-end', gap: 8 },
  installBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10 },
  installBtnText: { color: '#fff', fontWeight: '800', fontSize: 11.5 },
  logoutBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  logoutText:     { fontWeight: '800', fontSize: 11.5 },

  lbContainer:    { backgroundColor: '#000' },
  lbPage:         { alignItems: 'center', justifyContent: 'center' },
  lbBar:          { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 6 },
  lbBarRight:     { flexDirection: 'row', gap: 8 },
  lbBtn:          { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', marginTop: 8 },

  // web uniquement (ignorées sans effet sur natif) — scroll-snap CSS natif en
  // renfort de pagingEnabled, qui s'est déjà montré peu fiable sur
  // react-native-web seul (voir Post-mortem Feed, TACHES.md 2026-08-15).
  lbListWeb:      { scrollSnapType: 'x mandatory', overflowX: 'scroll' },
  lbPageWeb:      { scrollSnapAlign: 'start', scrollSnapStop: 'always' },

  /* Widget compact des 4 notes, bas-gauche — remplace l'ancien panneau
     métadonnées (date/description/conseils IA retirés, demande explicite
     d'interface minimaliste en plein écran). */
  lbScoresWrap:   { position: 'absolute', left: 16, gap: 6, alignItems: 'flex-start' },
  lbGlobalBadge:  { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16 },
  lbGlobalScore:  { color: '#fff', fontWeight: '800', fontSize: 15 },
  lbGlobalMax:    { color: 'rgba(255,255,255,0.85)', fontSize: 10.5, fontWeight: '700' },
  lbSubScoresRow: { flexDirection: 'row', gap: 6 },
  lbSubBadge:     { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(10,10,10,0.6)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  lbSubBadgeScore:{ fontSize: 12, fontWeight: '800' },

  profileCard:    { alignItems: 'center', padding: 20 },
  avatarContainer:{ position: 'relative', marginBottom: 12 },
  avatar:         { alignItems: 'center', justifyContent: 'center' },
  avatarImg:      {},
  avatarText:     { color: '#3a0d1e', fontWeight: '800' },
  avatarEdit:     { position: 'absolute', bottom: 0, right: 0, borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  avatarEditText: { fontSize: 14 },
  username:       { fontWeight: '700', fontSize: 20 },
  usernameRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  usernameBadge:  { fontSize: 18 },
  premiumBadge:   { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, borderWidth: 1, marginTop: -12, marginBottom: 14 },
  premiumBadgeText: { fontSize: 12, fontWeight: '800' },

  stats:          { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 16, width: '100%' },
  statItem:       { flex: 1, alignItems: 'center' },
  statNum:        { fontWeight: '800', fontSize: 22 },
  statLabel:      { fontSize: 11, marginTop: 2 },
  statDivider:    { width: 1, height: 30 },

  niveauCard:     { margin: 16, borderRadius: 16, padding: 16 },
  niveauLabel:    { fontWeight: '700', fontSize: 15, marginBottom: 10 },
  niveauBar:      { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  niveauFill:     { height: '100%', borderRadius: 4 },
  niveauSub:      { fontSize: 11 },

  actionsRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 16, marginBottom: 20 },
  actionBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5 },
  actionBtnText:  { fontWeight: '800', fontSize: 12.5 },

  galerieTitle:   { fontWeight: '700', fontSize: 16, padding: 16, paddingBottom: 8 },

  graphCard:        { margin: 16, marginTop: 0, borderRadius: 16, padding: 16 },
  graphHeaderRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  graphTitle:       { fontWeight: '700', fontSize: 15 },
  graphSegmentRow:  { flexDirection: 'row', gap: 6 },
  graphSegmentBtn:  { borderRadius: 10, borderWidth: 1.5, paddingHorizontal: 10, paddingVertical: 5 },
  graphSegmentText: { fontWeight: '800', fontSize: 11.5 },
  graphEmptyText:   { fontSize: 13, textAlign: 'center', paddingVertical: 20 },

  top3Section:    { paddingHorizontal: 16, gap: 16, marginTop: 4 },
  top3Block:      { gap: 8 },
  top3Title:      { fontWeight: '800', fontSize: 15, marginBottom: 2 },
  top3Row:        { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 10 },
  top3Rank:       { fontWeight: '900', fontSize: 15, width: 18, textAlign: 'center' },
  top3Avatar:     { width: 32, height: 32, borderRadius: 16 },
  top3Name:       { flex: 1, fontWeight: '600', fontSize: 14 },
  top3Score:      { fontWeight: '800', fontSize: 14 },
  privacyRow:     { flexDirection: 'row', alignItems: 'center', margin: 16, marginTop: 0, borderRadius: 16, padding: 16, borderWidth: 1 },
  privacyLeft:    { flex: 1, marginRight: 12 },
  privacyLabel:   { fontWeight: '700', fontSize: 14, marginBottom: 3 },
  privacySub:     { fontSize: 12, lineHeight: 17 },
  gridCell:       { width: '33.33%', aspectRatio: 1, padding: 3 },
  gridPhoto:      { width: '100%', height: '100%', borderRadius: 8, borderWidth: 1.5, borderColor: 'rgba(128,128,128,0.28)' },

  historyLockCard: { alignItems: 'center', gap: 6, borderRadius: 16, borderWidth: 1, padding: 20, margin: 12 },
  historyLockText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  historyLockCta:  { fontSize: 13, fontWeight: '800' },

  skeletonHeader: { padding: 20, paddingBottom: 10 },
  skeletonCard:   { alignItems: 'center', padding: 20 },
  skeletonStats:  { flexDirection: 'row', gap: 24, justifyContent: 'center', borderRadius: 16, padding: 16, marginTop: 16, width: '100%' },
  skeletonGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 2, padding: 2 },
  emptyGalerie:   { alignItems: 'center', padding: 40 },
  emptyText:      { fontSize: 16, fontWeight: '600' },
  emptySub:       { fontSize: 13, marginTop: 6 },

  /* Bouton Paramètres sous le titre */
  settingsBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  settingsBtnText: { fontSize: 12, fontWeight: '700' },

  /* Modal Paramètres */
  settingsOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  settingsSheet:        { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '85%' },
  settingsHandle:       { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  settingsTitle:        { fontWeight: '800', fontSize: 18, marginBottom: 20, textAlign: 'center' },
  settingsPhotoRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 16 },
  settingsAvatarThumb:  { width: 48, height: 48, borderRadius: 24 },
  settingsAvatarFallback:{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  settingsLabel:        { fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.5 },
  settingsInput:        { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 4 },
  settingsInputMulti:   { minHeight: 72, textAlignVertical: 'top' },
  settingsReadOnly:     { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  settingsFieldValue:   { fontSize: 14 },
  settingsPrivacyRow:   { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  settingsBtnsRow:      { flexDirection: 'row', gap: 10, marginTop: 20, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth },
  settingsCancel:       { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  settingsCancelText:   { fontWeight: '600', fontSize: 15 },
  settingsSave:         { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  settingsSaveText:     { color: '#fff', fontWeight: '800', fontSize: 15 },

  /* Top styles */
  stylesRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, justifyContent: 'center' },
  styleChip:     { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 5 },
  styleChipText: { fontSize: 12, fontWeight: '700' },
});
