import { supabase } from '../lib/supabase';
import {
  flammeOrderedIds,
  fetchAcceptedFriendIds,
  hasSnapUsedTodayForPair,
} from '../lib/flammesUtils';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { decode } from 'base64-arraybuffer';
import {
  View, Text, StyleSheet, ScrollView, Animated, Easing,
  Alert, TouchableOpacity, ActivityIndicator, Image, TextInput,
  FlatList, Modal, useWindowDimensions, Platform, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';
import { dismissDeliveredFlammeReminder } from '../lib/notifications';
import { ENV } from '../lib/env';
import Gauge from '../components/Gauge';
import Bouncy from '../components/Bouncy';
import AnimatedEntrance from '../components/AnimatedEntrance';
import CustomizationScreen from './CustomizationScreen';
import InAppCamera from '../components/InAppCamera';

const ACCENT      = '#ED93B1';
const BG          = '#FAF4F1';
const CARD        = '#FFFFFF';
const TIP_BG      = '#FBE8EE';
const CONSEIL_BG  = '#FBE9EF';
const TEXT_PRI    = '#2A2A2A';
const TEXT_SEC    = '#9A9A9A';
const BORDER      = '#F0E3DD';
const BTN_TEXT    = '#5C1A2E';

const REQUEST_TIMEOUT_MS = 25000;

const CRITERION_META = {
  fit: {
    icon: 'shirt-outline', name: 'Fit', color: '#ED93B1', track: '#F8E5EC',
    labels: [
      [8, 'Ajustement parfait !'],
      [6, 'Bonne silhouette'],
      [4, 'À ajuster'],
      [0, 'Coupes à rééquilibrer'],
    ],
    descs: [
      [8, "Les volumes et proportions valorisent parfaitement ta silhouette."],
      [6, "La coupe est équilibrée, quelques ajustements pourraient l'affiner."],
      [4, "L'équilibre des volumes et des longueurs mérite attention."],
      [0, "Les proportions et coupes gagneraient à être repensées."],
    ],
  },
  harmonie: {
    icon: 'color-palette-outline', name: 'Harmonie', color: '#B0809A', track: '#EFE3EA',
    labels: [
      [8, 'Palette maîtrisée !'],
      [6, 'Bon accord couleurs & matières'],
      [4, 'Quelques contrastes à harmoniser'],
      [0, 'Combinaison à rééquilibrer'],
    ],
    descs: [
      [8, "Couleurs et matières se complètent avec élégance."],
      [6, "L'accord chromatique fonctionne, les textures peuvent s'affiner."],
      [4, "Certaines couleurs ou matières créent une légère dissonance."],
      [0, "La palette et les matières manquent de cohérence."],
    ],
  },
  detail: {
    icon: 'sparkles-outline', name: 'Détails', color: '#C9A47A', track: '#F1E8DC',
    labels: [
      [8, 'Styling soigné !'],
      [6, 'Bons accessoires & finitions'],
      [4, 'Des détails à ajouter'],
      [0, 'Finitions à soigner'],
    ],
    descs: [
      [8, "Les accessoires et finitions élèvent la tenue au niveau supérieur."],
      [6, "Les détails renforcent le style, quelques ajouts sublimeront l'ensemble."],
      [4, "L'outfit manque d'une touche finale pour se démarquer."],
      [0, "Les accessoires et finitions nécessitent une attention particulière."],
    ],
  },
};

function criterionLabel(meta, value) {
  for (const [threshold, text] of meta.labels) {
    if (value >= threshold) return text;
  }
  return '';
}

function criterionDesc(meta, value) {
  for (const [threshold, text] of meta.descs) {
    if (value >= threshold) return text;
  }
  return '';
}

function ConseilBlock({ conseil, s }) {
  let structured = null;
  try {
    const p = JSON.parse(conseil);
    if (Array.isArray(p?.points_forts) && Array.isArray(p?.axes_amelioration)) structured = p;
  } catch (_) {}

  return (
    <View style={s.conseilCard}>
      <Text style={s.conseilEmoji}>💁‍♀️</Text>
      <View style={s.conseilTexts}>
        <Text style={s.conseilTitle}>Analyse complète</Text>
        {structured ? (
          <View>
            {structured.points_forts.length > 0 && (
              <View style={{ marginBottom: 10 }}>
                <Text style={s.conseilSectionTitle}>Points forts</Text>
                {structured.points_forts.map((pt, i) => (
                  <View key={i} style={s.conseilBullet}>
                    <Text style={s.conseilBulletDot}>✦</Text>
                    <Text style={s.conseilBulletText}>{pt}</Text>
                  </View>
                ))}
              </View>
            )}
            {structured.axes_amelioration.length > 0 && (
              <View>
                <Text style={s.conseilSectionTitle}>À améliorer</Text>
                {structured.axes_amelioration.map((ax, i) => (
                  <View key={i} style={s.conseilBullet}>
                    <Text style={s.conseilBulletDot}>→</Text>
                    <Text style={s.conseilBulletText}>{ax}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <Text style={s.conseilBody}>{conseil}</Text>
        )}
      </View>
    </View>
  );
}

function globalMessage(value) {
  if (value >= 8) return 'Tu as du style !';
  if (value >= 6) return 'Très bon look !';
  return 'Tu peux faire mieux !';
}

function fr(value) {
  return typeof value === 'number'
    ? (Number.isInteger(value) ? `${value},0` : value.toFixed(1).replace('.', ','))
    : '-';
}

function formatHearts(n) {
  if (!n) return '0';
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.', ',')}K`;
  return String(n);
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

export default function AccueilScreen({ navigation }) {
  const { width: ww } = useWindowDimensions();
  const ringSize = Math.min(Math.round(ww * 0.21), 86);
  const { theme } = useTheme();
  const s = useMemo(() => createStyles(theme), [theme]);

  const [image, setImage] = useState(null);
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [publishedToFeed, setPublishedToFeed] = useState(false);
  const [sentFlammesToAll, setSentFlammesToAll] = useState(false);
  const [postingFeed, setPostingFeed] = useState(false);
  const [sendingFlammesAll, setSendingFlammesAll] = useState(false);
  const [flammesPicker, setFlammesPicker] = useState({ visible: false, friends: [], loading: false });
  const [selectedMusic, setSelectedMusic] = useState(null); // { title, artist, previewUrl, coverUrl }
  const [showCustomization, setShowCustomization] = useState(false);
  const [savingForSelf, setSavingForSelf] = useState(false);
  const [showStyleHashtag, setShowStyleHashtag] = useState(true);
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [contextText, setContextText] = useState('');
  const [contextResult, setContextResult] = useState(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [musicPicker, setMusicPicker] = useState({ visible: false, query: '', results: [], searching: false });
  const musicSearchTimeout = useRef(null);
  const [caption, setCaption] = useState('');
  const [credits, setCredits] = useState(null);
  const [maxCredits, setMaxCredits] = useState(2);
  const [unlimited, setUnlimited] = useState(false);
  const [topOotds, setTopOotds] = useState([]);
  // Stories
  const [userId, setUserId] = useState(null);
  const [myStory, setMyStory] = useState(null);
  const [storyPreview, setStoryPreview] = useState({ visible: false, videoUri: null, imageUri: null, overlayText: '', caption: '', posting: false });
  const [storyViewer, setStoryViewer] = useState({ visible: false, story: null });
  // Caméra in-app (native uniquement — web garde le fallback file-input)
  const [inAppCamera, setInAppCamera] = useState({ visible: false, mode: 'photo' });
  const { showToast } = useToast();
  const cachedPublicUrlRef = useRef(null);
  const lastAnalyzedRef = useRef({ uri: null, ts: 0 });
  const resultFade = useRef(new Animated.Value(0)).current;
  const resultRise = useRef(new Animated.Value(14)).current;
  const barsProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!score) {
      resultFade.setValue(0);
      resultRise.setValue(14);
      barsProgress.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(resultFade, {
        toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(resultRise, {
        toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(barsProgress, {
        toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: false,
      }),
    ]).start();
  }, [score, barsProgress, resultFade, resultRise]);

  const fetchMyStory = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);
    const { data } = await supabase
      .from('stories')
      .select('id, user_id, image_url, video_url, overlay_text, caption, expires_at')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    setMyStory(data || null);
  }, []);

  const openStoryPicker = async () => {
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const uri = URL.createObjectURL(file);
        const isVideo = file.type.startsWith('video/');
        setStoryPreview({ visible: true, videoUri: isVideo ? uri : null, imageUri: !isVideo ? uri : null, overlayText: '', caption: '', posting: false });
      };
      input.click();
      return;
    }
    Alert.alert('Publier une story', 'Choisir le type de contenu', [
      { text: 'Vidéo (caméra)', onPress: () => {
        // Ouvre la caméra in-app en mode vidéo
        setInAppCamera({ visible: true, mode: 'video' });
      }},
      { text: 'Photo / vidéo (galerie)', onPress: async () => {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) { showToast('Permission galerie refusée', { type: 'warning' }); return; }
        const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsEditing: false });
        if (!res.canceled) {
          const asset = res.assets[0];
          const isVideo = asset.type === 'video' || (asset.uri || '').match(/\.(mp4|mov|avi)$/i);
          setStoryPreview({ visible: true, videoUri: isVideo ? asset.uri : null, imageUri: !isVideo ? asset.uri : null, overlayText: '', caption: '', posting: false });
        }
      }},
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const publishStory = async () => {
    const { videoUri, imageUri } = storyPreview;
    if (!videoUri && !imageUri) return;
    if (storyPreview.posting) return;
    setStoryPreview(prev => ({ ...prev, posting: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Session expirée. Reconnecte-toi.');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      let storyData = { user_id: user.id, expires_at: expiresAt, overlay_text: storyPreview.overlayText.trim() || null, caption: storyPreview.caption.trim() || null };

      if (videoUri) {
        const fileName = `${user.id}/${Date.now()}.mp4`;
        if (Platform.OS === 'web') {
          const resp = await fetch(videoUri);
          const blob = await resp.blob();
          const { error: upErr } = await supabase.storage.from('stories').upload(fileName, blob, { contentType: blob.type || 'video/mp4', upsert: false });
          if (upErr) throw upErr;
        } else {
          await new Promise((resolve, reject) => {
            const form = new FormData();
            form.append('', { uri: videoUri, name: `${Date.now()}.mp4`, type: 'video/mp4' });
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${ENV.supabaseUrl}/storage/v1/object/stories/${fileName}`);
            xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
            xhr.setRequestHeader('x-upsert', 'false');
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload ${xhr.status}`)));
            xhr.onerror = () => reject(new Error('Erreur réseau'));
            xhr.send(form);
          });
        }
        const { data: urlData } = supabase.storage.from('stories').getPublicUrl(fileName);
        storyData.video_url = urlData.publicUrl;
      } else if (imageUri) {
        const fileName = `${user.id}/${Date.now()}.jpg`;
        const resp = await fetch(imageUri);
        const blob = await resp.blob();
        const { error: upErr } = await supabase.storage.from('stories').upload(fileName, blob, { contentType: 'image/jpeg', upsert: false });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('stories').getPublicUrl(fileName);
        storyData.image_url = urlData.publicUrl;
      }

      const { error: insErr } = await supabase.from('stories').insert(storyData);
      if (insErr) throw insErr;
      setStoryPreview({ visible: false, videoUri: null, imageUri: null, overlayText: '', caption: '', posting: false });
      showToast('Story publiée ! Elle disparaît dans 24h ✨', { type: 'success' });
      fetchMyStory();
    } catch (e) {
      setStoryPreview(prev => ({ ...prev, posting: false }));
      showToast(e?.message || 'Impossible de publier la story', { type: 'error' });
    }
  };

  const fetchCredits = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data }, { data: sub }] = await Promise.all([
      supabase
        .from('profiles')
        .select('daily_credits, credits_reset_date, has_analysis_pass, has_ootd_plus_pass')
        .eq('id', user.id)
        .single(),
      supabase
        .from('subscriptions')
        .select('status, plan_type')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    if (!data) return;

    // Tier : Elite (abonnement) = illimité · Plus (abonnement) ou pass legacy = 20 · sinon 2
    const subActive = sub && ['active', 'trialing'].includes(sub.status);
    const plan = subActive ? sub.plan_type : null;
    const hasPass = !!(data.has_analysis_pass || data.has_ootd_plus_pass);

    if (plan === 'elite') {
      setUnlimited(true);
      setMaxCredits(Infinity);
      setCredits(Infinity);
      return;
    }

    setUnlimited(false);
    const max = (plan === 'plus' || hasPass) ? 20 : 2;
    setMaxCredits(max);
    const today = new Date().toISOString().split('T')[0];
    const effective = data.credits_reset_date < today ? max : data.daily_credits;
    setCredits(effective);
  }, []);

  const fetchTopOotds = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('ootds')
      .select('id, image_url, score_global, likes(count)')
      .eq('user_id', user.id)
      .order('score_global', { ascending: false })
      .limit(5);
    if (data) setTopOotds(data);
  }, []);

  useFocusEffect(useCallback(() => {
    fetchCredits();
    fetchTopOotds();
    fetchMyStory();
  }, [fetchCredits, fetchTopOotds, fetchMyStory]));

  const searchMusic = (query) => {
    setMusicPicker(prev => ({ ...prev, query }));
    if (musicSearchTimeout.current) clearTimeout(musicSearchTimeout.current);
    if (query.length < 2) { setMusicPicker(prev => ({ ...prev, results: [], searching: false })); return; }
    setMusicPicker(prev => ({ ...prev, searching: true }));
    musicSearchTimeout.current = setTimeout(async () => {
      try {
        // Recherche via le proxy Deezer (extraits 30 s) — CORS-safe pour la PWA.
        const { data } = await supabase.functions.invoke('deezer-search', { body: { q: query } });
        setMusicPicker(prev => ({ ...prev, results: data?.results || [], searching: false }));
      } catch (_) {
        setMusicPicker(prev => ({ ...prev, results: [], searching: false }));
      }
    }, 420);
  };

  const selectTrack = (track) => {
    // Le proxy renvoie déjà { title, artist, previewUrl, coverUrl }
    setSelectedMusic({
      title: track.title,
      artist: track.artist,
      previewUrl: track.previewUrl || null,
      coverUrl: track.coverUrl || null,
    });
    setMusicPicker({ visible: false, query: '', results: [], searching: false });
  };

  const applyPickedImage = (asset) => {
    setScore(null);
    cachedPublicUrlRef.current = null;
    setPublishedToFeed(false);
    setSentFlammesToAll(false);
    setShowContextPanel(false);
    setContextText('');
    setContextResult(null);
    setImage(asset);
  };

  // Web : capture via <input type=file>. `capture="environment"` ouvre l'appareil
  // photo (arrière) sur mobile. On compresse via canvas et on renvoie le base64
  // BRUT (analyzeOutfit reconstruit la data-URL `data:image/jpeg;base64,...`).
  const pickImageWeb = (useCamera) => {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (useCamera) input.setAttribute('capture', 'environment');
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const objectUrl = URL.createObjectURL(file);
      const img = new window.Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const maxDim = 1280;
        let { width, height } = img;
        if (width >= height && width > maxDim) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else if (height > width && height > maxDim) { width = Math.round((width * maxDim) / height); height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        // Deux encodages :
        //  • JPEG → envoyé à l'IA d'analyse (format le plus sûr/compatible).
        //  • WebP → STOCKÉ dans le feed (≈25-35% plus léger, rendu par tous les
        //    navigateurs modernes + expo-image). Repli JPEG si WebP non supporté
        //    (toDataURL renvoie alors du PNG → on détecte et on retombe sur JPEG).
        const jpegUrl = canvas.toDataURL('image/jpeg', 0.78);
        let uploadMime = 'image/webp';
        let uploadUrl = canvas.toDataURL(uploadMime, 0.72);
        if (!uploadUrl.startsWith('data:image/webp')) { uploadMime = 'image/jpeg'; uploadUrl = jpegUrl; }
        applyPickedImage({
          uri: uploadUrl,                                  // aperçu = exactement ce qui sera stocké
          base64: jpegUrl.split(',')[1] || null,           // analyse IA (JPEG)
          uploadBase64: uploadUrl.split(',')[1] || null,   // stockage feed (WebP/JPEG)
          uploadMime,
          width, height,
        });
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); showToast('Image illisible, réessaie', { type: 'error' }); };
      img.src = objectUrl;
    };
    input.click();
  };

  const pickImageFromLibrary = async () => {
    if (Platform.OS === 'web') { pickImageWeb(false); return; }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast('Permission refusée pour accéder à la galerie', { type: 'warning' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.75,
      allowsEditing: false,
      base64: true,
    });
    if (!result.canceled) {
      applyPickedImage(result.assets[0]);
    }
  };

  const takePicture = () => {
    if (Platform.OS === 'web') { pickImageWeb(true); return; }
    // Ouvre la caméra in-app (modal plein écran, sans quitter l'app)
    setInAppCamera({ visible: true, mode: 'photo' });
  };

  const openImageSourcePicker = () => {
    if (Platform.OS === 'web') { pickImageFromLibrary(); return; }
    Alert.alert(
      'Ajouter une tenue',
      'Choisis une source pour ta photo',
      [
        { text: 'Prendre une photo', onPress: takePicture },
        { text: 'Choisir dans la galerie', onPress: pickImageFromLibrary },
        { text: 'Annuler', style: 'cancel' },
      ]
    );
  };

  const analyzeOutfit = async () => {
    if (!image || credits === 0) return;
    const COOLDOWN_MS = 5 * 60 * 1000;
    if (
      image.uri === lastAnalyzedRef.current.uri &&
      Date.now() - lastAnalyzedRef.current.ts < COOLDOWN_MS
    ) {
      showToast('Cette tenue a déjà été analysée il y a moins de 5 minutes.', { type: 'warning' });
      return;
    }
    setLoading(true);
    try {
      if (!image.base64) {
        throw new Error("Impossible de lire la photo. Réessaie en choisissant une autre image.");
      }
      // L'analyse reçoit toujours du JPEG (format le plus compatible avec l'IA).
      const base64Image = `data:image/jpeg;base64,${image.base64}`;
      const { data: parsed, error: fnError } = await withTimeout(
        supabase.functions.invoke("analyze-outfit", { body: { base64Image } }),
        REQUEST_TIMEOUT_MS,
        "L'analyse est trop longue. Verifie ta connexion et reessaie.",
      );
      if (fnError) {
        let errMsg = "Analyse indisponible";
        try {
          const errBody = await fnError.context?.json?.();
          if (errBody?.error) errMsg = errBody.error;
          if (typeof errBody?.credits === "number") setCredits(errBody.credits);
        } catch (_) {}
        throw new Error(errMsg);
      }
      if (!parsed || typeof parsed.global !== "number") throw new Error("Reponse IA invalide, reessaie.");
      if (parsed.max_credits === -1 || parsed.credits_remaining === -1) {
        setUnlimited(true);
        setCredits(Infinity);
        setMaxCredits(Infinity);
      } else {
        if (typeof parsed.credits_remaining === "number") setCredits(parsed.credits_remaining);
        if (typeof parsed.max_credits === "number") setMaxCredits(parsed.max_credits);
      }
      cachedPublicUrlRef.current = null;
      setPublishedToFeed(false);
      setSentFlammesToAll(false);
      lastAnalyzedRef.current = { uri: image.uri, ts: Date.now() };
      setScore(parsed);
    } catch (e) {
      showToast(e.message || "Une erreur est survenue pendant l'analyse.", { type: "error" });
      console.log("analyzeOutfit error:", e);
    }
    setLoading(false);
  };

  const analyzeContext = async () => {
    if (!image || !contextText.trim() || loadingContext) return;
    setLoadingContext(true);
    try {
      if (!image.base64) throw new Error('Image introuvable.');
      const base64Image = `data:image/jpeg;base64,${image.base64}`;
      const { data: parsed, error: fnError } = await withTimeout(
        supabase.functions.invoke('contextual-analysis', { body: { base64Image, context: contextText.trim() } }),
        REQUEST_TIMEOUT_MS,
        "L'analyse contextuelle est trop longue. Verifie ta connexion.",
      );
      if (fnError) {
        let errMsg = 'Analyse contextuelle indisponible';
        try {
          const errBody = await fnError.context?.json?.();
          if (errBody?.error) errMsg = errBody.error;
          if (typeof errBody?.credits === 'number') setCredits(errBody.credits);
        } catch (_) {}
        throw new Error(errMsg);
      }
      if (!parsed || typeof parsed.coherent !== 'boolean') throw new Error('Reponse IA invalide.');
      if (typeof parsed.credits_remaining === 'number') setCredits(parsed.credits_remaining);
      setContextResult(parsed);
    } catch (e) {
      showToast(e.message || 'Erreur analyse contextuelle.', { type: 'error' });
    }
    setLoadingContext(false);
  };

  const uploadAnalyzedImageIfNeeded = useCallback(async () => {
    if (cachedPublicUrlRef.current) return cachedPublicUrlRef.current;
    // Stockage feed : WebP si dispo (web), sinon JPEG (web sans support / natif).
    const upBase64 = image?.uploadBase64 || image?.base64;
    if (!upBase64) {
      throw new Error('Image introuvable. Reprends une photo.');
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Session expirée. Reconnecte-toi.');
    const mime = image.uploadMime || 'image/jpeg';
    const ext = mime === 'image/webp' ? 'webp' : 'jpg';
    const fileName = `${user.id}/outfit_${Date.now()}.${ext}`;
    const imageBuffer = decode(upBase64);
    const { error: uploadError } = await supabase.storage
      .from('ootds')
      .upload(fileName, imageBuffer, { contentType: mime });
    if (uploadError) {
      if (uploadError.message?.toLowerCase().includes('bucket not found')) {
        throw new Error("Le bucket 'ootds' est introuvable dans Supabase Storage.");
      }
      throw new Error(`Upload impossible: ${uploadError.message}`);
    }
    const { data: urlData } = supabase.storage.from('ootds').getPublicUrl(fileName);
    const url = urlData.publicUrl;
    cachedPublicUrlRef.current = url;
    return url;
  }, [image]);

  const publishToFeed = async () => {
    if (!score || publishedToFeed || postingFeed) return;
    setPostingFeed(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expirée. Reconnecte-toi.');
      const publicUrl = await uploadAnalyzedImageIfNeeded();
      const { data: insertData, error: insertError } = await supabase.from('ootds').insert({
        user_id: user.id,
        image_url: publicUrl,
        score_global: score.global,
        score_couleurs: score.harmonie,
        score_coupe: score.fit,
        score_tendance: score.detail,
        conseil: score.conseil,
        caption: caption.trim() || null,
        is_public: true,
        styles: score.styles || [],
        show_style_hashtag: showStyleHashtag,
        audio_title: selectedMusic?.title || null,
        audio_artist: selectedMusic?.artist || null,
        audio_preview_url: selectedMusic?.previewUrl || null,
        audio_cover_url: selectedMusic?.coverUrl || null,
      }).select('id').single();
      if (insertError) throw new Error(`Publication impossible: ${insertError.message}`);
      const { data: awardResult, error: awardError } = await supabase.rpc('award_points_for_ootd', { p_ootd_id: insertData.id });
      if (awardError) throw new Error(`Points: ${awardError.message}`);
      if (!awardResult?.ok) throw new Error(awardResult?.error || 'Erreur attribution points');
      const pointsGagnes = awardResult.points_earned;
      if ((score.styles || []).length > 0) {
        try { await supabase.rpc('increment_style_stats', { p_styles: score.styles }); } catch (_) {}
      }
      setPublishedToFeed(true);
      setCaption('');
      setSelectedMusic(null);
      showToast(`Ta tenue est dans le feed. +${pointsGagnes} points.`, { type: 'success' });
      // Ferme la personnalisation et redirige vers le feed
      setShowCustomization(false);
      try { navigation.navigate('Accueil'); } catch (_) {}
    } catch (e) {
      showToast(e?.message || 'Erreur inconnue', { type: 'error' });
    }
    setPostingFeed(false);
  };

  // 💾 Enregistrer pour soi : stocke l'outfit dans la galerie perso uniquement
  // (is_public:false → absent du feed). Pas de publication ni d'envoi.
  const saveForSelf = async () => {
    if (!score || savingForSelf) return;
    setSavingForSelf(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expirée. Reconnecte-toi.');
      const publicUrl = await uploadAnalyzedImageIfNeeded();
      const { data: ins, error } = await supabase.from('ootds').insert({
        user_id: user.id,
        image_url: publicUrl,
        score_global: score.global,
        score_couleurs: score.harmonie,
        score_coupe: score.fit,
        score_tendance: score.detail,
        conseil: score.conseil,
        caption: caption.trim() || null,
        is_public: false,
        styles: score.styles || [],
        audio_title: selectedMusic?.title || null,
        audio_artist: selectedMusic?.artist || null,
        audio_preview_url: selectedMusic?.previewUrl || null,
        audio_cover_url: selectedMusic?.coverUrl || null,
      }).select('id').single();
      if (error) throw new Error(error.message);
      try { await supabase.rpc('award_points_for_ootd', { p_ootd_id: ins.id }); } catch (_) {}
      setCaption('');
      setSelectedMusic(null);
      setShowCustomization(false);
      showToast('Enregistré dans ta galerie 💾', { type: 'success' });
    } catch (e) {
      showToast(e?.message || 'Erreur inconnue', { type: 'error' });
    }
    setSavingForSelf(false);
  };

  // Ouvre le sélecteur d'amis avant d'envoyer
  const openFlammesPicker = async () => {
    if (!score || sentFlammesToAll || sendingFlammesAll) return;
    // Ouvre la modale immédiatement avec un indicateur de chargement
    setFlammesPicker({ visible: true, friends: [], loading: true });
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setFlammesPicker({ visible: false, friends: [], loading: false }); return; }
      const friendIds = await fetchAcceptedFriendIds(supabase, user.id);
      if (!friendIds?.length) {
        setFlammesPicker({ visible: false, friends: [], loading: false });
        Alert.alert('Aucun ami', "Accepte des amis dans l'onglet Chat pour leur envoyer ton outfit.");
        return;
      }
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', friendIds);
      setFlammesPicker({
        visible: true,
        loading: false,
        friends: (profiles || []).map(p => ({ ...p, selected: false })),
      });
    } catch (e) {
      setFlammesPicker({ visible: false, friends: [], loading: false });
      showToast('Impossible de charger tes contacts. Réessaie.', { type: 'error' });
    }
  };

  const toggleFlammesFriend = (id) => {
    setFlammesPicker(prev => ({
      ...prev,
      friends: prev.friends.map(f => f.id === id ? { ...f, selected: !f.selected } : f),
    }));
  };

  const sendOutfitToSelectedFlammes = async () => {
    const selectedIds = (flammesPicker.friends || []).filter(f => f.selected).map(f => f.id);
    if (!selectedIds.length) {
      showToast('Sélectionne au moins un ami', { type: 'warning' });
      return;
    }
    setFlammesPicker(prev => ({ ...prev, visible: false }));
    setSendingFlammesAll(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expirée. Reconnecte-toi.');
      const publicUrl = await uploadAnalyzedImageIfNeeded();
      const { data: myFlammes } = await supabase
        .from('flammes')
        .select('*')
        .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`);
      const flammesLocal = [...(myFlammes || [])];
      let sent = 0;
      let skipped = 0;
      for (const friendId of selectedIds) {
        try {
          if (await hasSnapUsedTodayForPair(supabase, user.id, friendId)) { skipped += 1; continue; }
          const { error: snapErr } = await supabase.from('snaps').insert({ sender_id: user.id, receiver_id: friendId, image_url: publicUrl });
          if (snapErr) { console.error('snap insert failed:', snapErr); continue; }
          await supabase.from('messages').insert({ sender_id: user.id, receiver_id: friendId, image_url: publicUrl });
          sent += 1;
          const flamme = flammesLocal.find(f =>
            (f.user1_id === user.id && f.user2_id === friendId) ||
            (f.user1_id === friendId && f.user2_id === user.id),
          );
          const now = new Date();
          if (flamme) {
            const diffHours = (now - (flamme.last_snap_at ? new Date(flamme.last_snap_at) : new Date(0))) / 3600000;
            const newStreak = diffHours < 24 ? flamme.streak + 1 : 1;
            await supabase.from('flammes').update({ streak: newStreak, last_snap_at: now.toISOString() }).eq('id', flamme.id);
            flamme.streak = newStreak; flamme.last_snap_at = now.toISOString();
          } else {
            const { data: ins, error: insErr } = await supabase
              .from('flammes').insert({ ...flammeOrderedIds(user.id, friendId), streak: 1, last_snap_at: now.toISOString() }).select().single();
            if (!insErr && ins) flammesLocal.push(ins);
          }
        } catch (loopErr) { console.warn('flamme loop', loopErr); }
      }
      if (sent > 0) {
        setSentFlammesToAll(true);
        dismissDeliveredFlammeReminder(); // photo envoyée → on retire le rappel affiché
        // Enregistrement parallèle dans la galerie perso (hors feed)
        try {
          await supabase.from('ootds').insert({
            user_id: user.id, image_url: publicUrl, is_public: false,
            score_global: score.global, score_couleurs: score.harmonie,
            score_coupe: score.fit, score_tendance: score.detail,
            conseil: score.conseil, caption: caption.trim() || null,
            styles: score.styles || [],
            audio_title: selectedMusic?.title || null, audio_artist: selectedMusic?.artist || null,
            audio_preview_url: selectedMusic?.previewUrl || null, audio_cover_url: selectedMusic?.coverUrl || null,
          });
        } catch (_) {}
        setShowCustomization(false);
      }
      const msg = sent > 0
        ? `${sent} ami(s) ont reçu ton outfit 🔥${skipped > 0 ? ` · ${skipped} ignoré(s) (déjà envoyé aujourd'hui)` : ''}`
        : "Aucun envoi : snap déjà envoyé à ces amis aujourd'hui.";
      showToast(msg, { type: sent > 0 ? 'success' : 'info' });
    } catch (e) {
      showToast(e?.message || 'Erreur inconnue', { type: 'error' });
    }
    setSendingFlammesAll(false);
  };

  return (
    <SafeAreaView style={s.safe} edges={[]}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ===== AVANT — pas encore de score ===== */}
        {!score && (
          <AnimatedEntrance distance={16} duration={360}>
            {/* En-tête */}
            <View style={s.beforeHeader}>
              <Text style={s.title}>Analyse ton OOTD ✨</Text>
              <Ionicons name="notifications-outline" size={22} color={theme.textSub} style={s.bellIcon} />
            </View>
            <Text style={s.subtitle}>
              Prends une photo de ta tenue pour obtenir ton analyse personnalisée.
            </Text>

            {/* Carte upload — bordure pointillée */}
            <View style={s.uploadCard}>
              {image ? (
                <TouchableOpacity onPress={openImageSourcePicker} activeOpacity={0.88}>
                  <Image source={{ uri: image.uri }} style={s.previewImg} />
                  <View style={s.changeOverlay}>
                    <Text style={s.changeOverlayText}>Changer la photo</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={s.uploadOption} onPress={takePicture} activeOpacity={0.8}>
                    <LinearGradient
                      colors={['#F7A8C4', '#ED7AA6']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={s.cameraCircle}
                    >
                      <Ionicons name="camera" size={34} color="#fff" />
                    </LinearGradient>
                    <Text style={s.uploadOptionText}>Prendre une photo</Text>
                    <Text style={s.uploadOptionSub}>Place-toi bien, en pied si possible</Text>
                  </TouchableOpacity>

                  <View style={s.dividerRow}>
                    <View style={s.dividerLine} />
                    <Text style={s.dividerText}>ou</Text>
                    <View style={s.dividerLine} />
                  </View>

                  <TouchableOpacity style={s.uploadOption} onPress={pickImageFromLibrary} activeOpacity={0.8}>
                    <View style={s.galleryCircle}>
                      <Ionicons name="image-outline" size={26} color="#B7A9A2" />
                    </View>
                    <Text style={s.uploadOptionText}>Choisir dans la galerie</Text>
                    <Text style={s.uploadOptionSub}>Sélectionne une photo existante</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Pastille crédits */}
            <View style={s.creditsRow}>
              <View style={[s.creditsChip, credits === 0 && s.creditsChipEmpty]}>
                <Ionicons name="flash" size={13} color={credits === 0 ? TEXT_SEC : ACCENT} />
                <Text style={[s.creditsChipText, credits === 0 && s.creditsChipTextEmpty]}>
                  {unlimited ? 'Analyses illimitées' : credits === null ? '...' : `${credits}/${maxCredits} analyses`}
                </Text>
              </View>
            </View>

            {/* Plus de crédits */}
            {!unlimited && credits === 0 && (
              <View style={s.noCreditsCard}>
                <Text style={s.noCreditsTitle}>⚡ Analyses épuisées</Text>
                <Text style={s.noCreditsText}>
                  Tes {maxCredits} analyses quotidiennes sont utilisées. Reviens demain ou obtiens un pass.
                </Text>
                <TouchableOpacity
                  style={s.noCreditsBtn}
                  onPress={() => navigation.navigate('Shop')}
                  activeOpacity={0.85}
                >
                  <Text style={s.noCreditsBtnText}>Obtenir plus de crédits →</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Bouton analyser */}
            {image && credits !== 0 && (
              <Bouncy
                style={[s.analyzeBtn, (loading || credits === null) && s.analyzeBtnDisabled]}
                onPress={analyzeOutfit}
                disabled={loading || credits === null}
              >
                {loading ? (
                  <View style={s.analyzeBtnInner}>
                    <ActivityIndicator color="#1a0a10" size="small" />
                    <Text style={s.analyzeBtnText}>  Analyse en cours...</Text>
                  </View>
                ) : (
                  <Text style={s.analyzeBtnText}>✨ Analyser ma tenue</Text>
                )}
              </Bouncy>
            )}

            {/* Conseil contextuel — saisi avant l'analyse */}
            {image && (
              <View style={{ marginBottom: 15 }}>
                <TouchableOpacity
                  style={s.contextBtn}
                  onPress={() => { setShowContextPanel(p => !p); setContextResult(null); }}
                  activeOpacity={0.85}
                >
                  <Ionicons name="location-outline" size={16} color="#1a0a10" />
                  <Text style={s.contextBtnText}>
                    {showContextPanel ? 'Masquer le conseil contextuel' : 'Conseil contextuel'}
                  </Text>
                </TouchableOpacity>
                {showContextPanel && (
                  <View style={s.contextPanel}>
                    <Text style={s.contextLabel}>Decris le contexte de ta tenue</Text>
                    <TextInput
                      style={s.contextInput}
                      placeholder="Ex : soiree formelle, rendez-vous professionnel..."
                      placeholderTextColor={TEXT_SEC}
                      value={contextText}
                      onChangeText={setContextText}
                      maxLength={120}
                      multiline
                    />
                    <Bouncy
                      style={[s.contextAnalyzeBtn, (loadingContext || !contextText.trim()) && s.analyzeBtnDisabled]}
                      onPress={analyzeContext}
                      disabled={loadingContext || !contextText.trim()}
                    >
                      {loadingContext ? (
                        <View style={s.analyzeBtnInner}>
                          <ActivityIndicator color="#1a0a10" size="small" />
                          <Text style={s.analyzeBtnText}>  Analyse...</Text>
                        </View>
                      ) : (
                        <Text style={s.analyzeBtnText}>Analyser le contexte</Text>
                      )}
                    </Bouncy>
                    {contextResult && (
                      <View style={[s.contextResultCard, { borderColor: contextResult.coherent ? '#4AFF7A44' : '#FF8C0044' }]}>
                        {/* Badge verdict */}
                        <View style={[s.contextBadge, { backgroundColor: contextResult.coherent ? '#4AFF7A18' : '#FF8C0018' }]}>
                          <Ionicons
                            name={contextResult.coherent ? 'checkmark-circle' : 'alert-circle'}
                            size={15}
                            color={contextResult.coherent ? '#4AFF7A' : '#FF8C00'}
                          />
                          <Text style={[s.contextBadgeText, { color: contextResult.coherent ? '#4AFF7A' : '#FF8C00' }]}>
                            {contextResult.badge || (contextResult.coherent ? 'Validé pour la situation' : 'À ajuster')}
                          </Text>
                        </View>
                        {/* Pourquoi (nouveau champ) ou fallback explication */}
                        {!!(contextResult.pourquoi || contextResult.explication) && (
                          <Text style={s.contextExplication}>
                            {contextResult.pourquoi || contextResult.explication}
                          </Text>
                        )}
                        {/* Conseil */}
                        {!!contextResult.conseil && (
                          <Text style={s.contextConseil}>{contextResult.conseil}</Text>
                        )}
                        {/* Alternative (si tenue inadaptée) */}
                        {!!contextResult.alternative && (
                          <View style={s.contextAltBlock}>
                            <Text style={s.contextAltLabel}>Alternative :</Text>
                            <Text style={s.contextAltText}>{contextResult.alternative}</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Carte conseil */}
            <View style={s.tipCard}>
              <View style={s.tipIconWrap}>
                <Ionicons name="bulb-outline" size={20} color={theme.accent} />
              </View>
              <View style={s.tipTexts}>
                <Text style={s.tipTitle}>Conseil <Text style={s.tipHeart}>🤍</Text></Text>
                <Text style={s.tipBody}>
                  Une bonne lumière et une photo complète de ta tenue aident à l'analyser au mieux !
                </Text>
              </View>
            </View>

            {/* Comment ça marche */}
            <Text style={s.howTitle}>Comment ça marche ?</Text>
            <View style={s.howRow}>
              {[
                { icon: 'camera-outline',     title: '1. Prends ta photo',        text: 'Prends une photo de ta tenue en pied, dans un endroit bien éclairé.' },
                { icon: 'sparkles-outline',   title: '2. Analyse personnalisée',  text: "Notre IA analyse ton look selon plusieurs critères de style et d'harmonie." },
                { icon: 'star-outline',       title: '3. Reçois ton feedback',    text: 'Découvre ta note, des conseils et des astuces pour tes prochains looks !' },
              ].map((item, i) => (
                <View key={i} style={s.howCard}>
                  <View style={s.howIconCircle}>
                    <Ionicons name={item.icon} size={20} color={theme.accent} />
                  </View>
                  <Text style={s.howCardTitle}>{item.title}</Text>
                  <Text style={s.howText}>{item.text}</Text>
                </View>
              ))}
            </View>
          </AnimatedEntrance>
        )}

        {/* ===== APRÈS — score disponible ===== */}
        {score && (
          <Animated.View style={{ opacity: resultFade, transform: [{ translateY: resultRise }] }}>

            {/* En-tête */}
            <View style={s.afterHeader}>
              <View style={s.afterHeaderLeft}>
                <Text style={s.titleLeft}>Analyse de tes OOTD ✨</Text>
                <Text style={s.subtitleLeft}>Tes statistiques sur 30 derniers jours</Text>
              </View>
              <TouchableOpacity style={s.searchBtn} onPress={openImageSourcePicker}>
                <Ionicons name="search" size={18} color={theme.textPri} />
              </TouchableOpacity>
            </View>

            {/* Photo analysée — reste visible avec les résultats */}
            {image?.uri && (
              <Image source={{ uri: image.uri }} style={s.resultPhoto} />
            )}

            {/* 3 cartes critères */}
            <View style={s.criterionRow}>
              {['fit', 'harmonie', 'detail'].map(key => {
                const meta = CRITERION_META[key];
                const val = score[key];
                return (
                  <View key={key} style={s.criterionCard}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} style={{ marginBottom: 4 }} />
                    <Text style={s.criterionName}>{meta.name}</Text>
                    <Gauge value={val} size={ringSize} thickness={Math.round(ringSize * 0.1)} color={meta.color} track={meta.track} textColor={theme.textPri} />
                    <Text style={[s.criterionLabel, { color: meta.color }]}>{criterionLabel(meta, val)}</Text>
                    <Text style={s.criterionDesc}>{criterionDesc(meta, val)}</Text>
                  </View>
                );
              })}
            </View>

            {/* Note globale */}
            <View style={s.globalCard}>
              <View style={s.globalLeft}>
                <Text style={s.globalCardTitle}>Note globale <Text style={s.tipHeart}>🤍</Text></Text>
                <View style={s.globalScoreRow}>
                  <Text style={s.globalScore}>{fr(score.global)}</Text>
                  <Text style={s.globalSub}> /10</Text>
                </View>
              </View>
              <View style={s.globalDivider} />
              <View style={s.globalRight}>
                <Text style={s.globalMessage}>{globalMessage(score.global)}</Text>
                <Text style={s.globalMessageSub}>Continue comme ça, tu es sur la bonne voie.</Text>
              </View>
              <View style={s.globalStarBadge}>
                <Ionicons name="star" size={16} color="#fff" />
              </View>
            </View>

            {/* Conseil structuré */}
            <ConseilBlock conseil={score.conseil} s={s} />

            {/* Top OOTDs */}
            {topOotds.length > 0 && (
              <View style={s.topSection}>
                <View style={s.topHeader}>
                  <Text style={s.topTitle}>Tes OOTD les plus performants</Text>
                  <Text style={s.topSeeAll}>Voir tout</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {topOotds.map(ootd => {
                    const hearts = Array.isArray(ootd.likes) ? (ootd.likes[0]?.count || 0) : 0;
                    return (
                      <View key={ootd.id} style={s.topItem}>
                        <Image source={{ uri: ootd.image_url }} style={s.topImg} />
                        <View style={s.topHeartChip}>
                          <Ionicons name="heart" size={10} color={theme.accent} />
                          <Text style={s.topHeartText}>{formatHearts(hearts)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Actions post-analyse */}
            <View style={s.postAnalysisActions}>
              <Bouncy
                style={s.actionPrimary}
                onPress={() => setShowCustomization(true)}
              >
                <Text style={s.actionPrimaryText}>✏️ Personnaliser et partager</Text>
              </Bouncy>
              <TouchableOpacity
                style={s.retryBtn}
                onPress={() => {
                  setImage(null);
                  setScore(null);
                  cachedPublicUrlRef.current = null;
                  setPublishedToFeed(false);
                  setSentFlammesToAll(false);
                  setShowContextPanel(false);
                  setContextText('');
                  setContextResult(null);
                }}
              >
                <Text style={s.retryText}>Analyser une nouvelle tenue</Text>
              </TouchableOpacity>
            </View>

          </Animated.View>
        )}

        {/* ===== SECTION STORIES (toujours visible en scrollant) ===== */}
        <View style={s.storiesSection}>
          <View style={s.storiesSectionHeader}>
            <Feather name="circle" size={16} color={ACCENT} />
            <Text style={s.storiesSectionTitle}>Ma story</Text>
            <Text style={s.storiesSectionSub}>Disparaît dans 24h</Text>
          </View>

          {myStory ? (
            /* Story active — aperçu + option remplacer */
            <TouchableOpacity style={s.myStoryPreview} onPress={() => setStoryViewer({ visible: true, story: myStory })} activeOpacity={0.85}>
              {myStory.image_url ? (
                <ExpoImage source={{ uri: myStory.image_url }} style={s.myStoryThumb} contentFit="cover" />
              ) : (
                <View style={[s.myStoryThumb, { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }]}>
                  <Feather name="video" size={28} color="#fff" />
                </View>
              )}
              <View style={s.myStoryOverlay}>
                <Text style={s.myStoryOverlayText}>Voir ma story</Text>
              </View>
              <View style={[s.storyActiveBadge, { backgroundColor: ACCENT }]}>
                <View style={s.storyActiveDot} />
                <Text style={s.storyActiveTxt}>En ligne</Text>
              </View>
            </TouchableOpacity>
          ) : (
            /* Pas de story — bouton publier */
            <TouchableOpacity style={s.storyPublishBtn} onPress={openStoryPicker} activeOpacity={0.85}>
              <LinearGradient colors={['#F7A8C4', '#ED7AA6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.storyPublishGradient}>
                <Feather name="plus" size={26} color="#fff" />
              </LinearGradient>
              <View>
                <Text style={s.storyPublishTitle}>Publier une story</Text>
                <Text style={s.storyPublishSub}>Photo ou vidéo · visible 24h</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Story viewer modal */}
        <Modal visible={storyViewer.visible} transparent animationType="fade" onRequestClose={() => setStoryViewer({ visible: false, story: null })}>
          <View style={s.viewerOverlay}>
            <View style={s.viewerHeader}>
              <Text style={s.viewerUsername}>Ma story</Text>
              <TouchableOpacity onPress={() => setStoryViewer({ visible: false, story: null })}>
                <Feather name="x" size={26} color="#fff" />
              </TouchableOpacity>
            </View>
            {storyViewer.story?.video_url ? (
              <Video source={{ uri: storyViewer.story.video_url }} style={s.viewerMedia} resizeMode={ResizeMode.CONTAIN} useNativeControls shouldPlay isLooping={false} />
            ) : storyViewer.story?.image_url ? (
              <ExpoImage source={{ uri: storyViewer.story.image_url }} style={s.viewerMedia} contentFit="contain" />
            ) : null}
            {storyViewer.story?.overlay_text ? (
              <View style={s.viewerTextWrap}><Text style={s.viewerText}>{storyViewer.story.overlay_text}</Text></View>
            ) : null}
            <TouchableOpacity style={s.replaceStoryBtn} onPress={() => { setStoryViewer({ visible: false, story: null }); openStoryPicker(); }}>
              <Text style={s.replaceStoryBtnText}>Remplacer la story</Text>
            </TouchableOpacity>
          </View>
        </Modal>

        {/* Story preview / publication modal */}
        <Modal
          visible={storyPreview.visible}
          transparent
          animationType="slide"
          onRequestClose={() => { if (!storyPreview.posting) setStoryPreview(prev => ({ ...prev, visible: false })); }}
        >
          <View style={s.storyModalOverlay}>
            <View style={[s.storyModalSheet, { backgroundColor: theme.card }]}>
              <View style={[s.storyModalHandle, { backgroundColor: theme.border }]} />
              <Text style={[s.storyModalTitle, { color: theme.textPri }]}>Publier une story</Text>
              <View style={s.storyVideoWrap}>
                {storyPreview.videoUri ? (
                  <Video source={{ uri: storyPreview.videoUri }} style={s.storyVideoPreview} resizeMode={ResizeMode.CONTAIN} useNativeControls shouldPlay={false} isLooping={false} />
                ) : storyPreview.imageUri ? (
                  <ExpoImage source={{ uri: storyPreview.imageUri }} style={s.storyVideoPreview} contentFit="contain" />
                ) : (
                  <Feather name="image" size={36} color={TEXT_SEC} />
                )}
              </View>
              <Text style={[s.storyFieldLabel, { color: TEXT_SEC }]}>Texte sur la story (optionnel)</Text>
              <TextInput
                style={[s.storyFieldInput, { backgroundColor: theme.bg, borderColor: BORDER, color: TEXT_PRI }]}
                placeholder="Ex : Mon look du jour ✨"
                placeholderTextColor={TEXT_SEC}
                value={storyPreview.overlayText}
                onChangeText={t => setStoryPreview(prev => ({ ...prev, overlayText: t }))}
                maxLength={60}
                editable={!storyPreview.posting}
              />
              <Text style={[s.storyFieldLabel, { color: TEXT_SEC }]}>Description (optionnel)</Text>
              <TextInput
                style={[s.storyFieldInput, s.storyFieldInputMulti, { backgroundColor: theme.bg, borderColor: BORDER, color: TEXT_PRI }]}
                placeholder="Décris ta tenue..."
                placeholderTextColor={TEXT_SEC}
                value={storyPreview.caption}
                onChangeText={t => setStoryPreview(prev => ({ ...prev, caption: t }))}
                maxLength={200}
                multiline
                editable={!storyPreview.posting}
              />
              <View style={s.storyModalBtns}>
                <TouchableOpacity style={[s.storyModalCancel, { backgroundColor: theme.border }]} onPress={() => setStoryPreview(prev => ({ ...prev, visible: false }))} disabled={storyPreview.posting}>
                  <Text style={[s.storyModalCancelText, { color: TEXT_PRI }]}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.storyModalPublish, { backgroundColor: ACCENT }, storyPreview.posting && { opacity: 0.6 }]} onPress={publishStory} disabled={storyPreview.posting}>
                  {storyPreview.posting ? <ActivityIndicator color="#3a0d1e" size="small" /> : <Text style={s.storyModalPublishText}>Publier</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </ScrollView>

      {/* Caméra in-app (photo tenue / vidéo story) */}
      <InAppCamera
        visible={inAppCamera.visible}
        mode={inAppCamera.mode}
        onClose={() => setInAppCamera(prev => ({ ...prev, visible: false }))}
        onCapture={(asset) => {
          setInAppCamera(prev => ({ ...prev, visible: false }));
          if (inAppCamera.mode === 'video') {
            if (asset?.uri) {
              setStoryPreview({ visible: true, videoUri: asset.uri, imageUri: null, overlayText: '', caption: '', posting: false });
            }
          } else {
            // Photo tenue : l'IA attend image.base64 (JPEG brut)
            applyPickedImage(asset);
          }
        }}
      />

      {/* Écran de personnalisation (modal plein écran) */}
      <CustomizationScreen
        visible={showCustomization && !!score}
        onClose={() => setShowCustomization(false)}
        theme={theme}
        imageUri={image?.uri}
        score={score}
        caption={caption}
        setCaption={setCaption}
        selectedMusic={selectedMusic}
        setSelectedMusic={setSelectedMusic}
        musicPicker={musicPicker}
        setMusicPicker={setMusicPicker}
        searchMusic={searchMusic}
        selectTrack={selectTrack}
        onPublish={publishToFeed}
        onFlammes={() => { setShowCustomization(false); openFlammesPicker(); }}
        onSaveForSelf={saveForSelf}
        posting={postingFeed}
        sendingFlammes={sendingFlammesAll}
        saving={savingForSelf}
        showStyleHashtag={showStyleHashtag}
        setShowStyleHashtag={setShowStyleHashtag}
      />
    </SafeAreaView>
  );
}

function createStyles(theme) {
  const BG_T    = theme.bg;
  const CARD_T  = theme.card;
  const ACC_T   = theme.accent;
  const PRI_T   = theme.textPri;
  const SUB_T   = theme.textSub;
  const BRD_T   = theme.border;
  const TIP_T   = theme.accent + '18';
  return StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG_T },
  scroll: { padding: 20, paddingBottom: 48 },

  // Titres
  beforeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  bellIcon:     { position: 'absolute', right: 0 },
  title:    { fontSize: 22, fontWeight: '800', color: PRI_T, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, color: SUB_T, textAlign: 'center', lineHeight: 19, marginBottom: 20, paddingHorizontal: 12 },
  titleLeft:    { fontSize: 21, fontWeight: '800', color: PRI_T, marginBottom: 3 },
  subtitleLeft: { fontSize: 12, color: SUB_T, lineHeight: 17 },

  // Carte upload
  uploadCard: {
    backgroundColor: CARD_T,
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: BRD_T,
    borderStyle: 'dashed',
  },
  uploadOption:    { alignItems: 'center', paddingVertical: 6 },
  cameraCircle: {
    width: 84, height: 84, borderRadius: 42,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
    shadowColor: ACC_T, shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  galleryCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: BG_T,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  uploadOptionText: { fontSize: 16, fontWeight: '700', color: PRI_T },
  uploadOptionSub:  { fontSize: 12, color: SUB_T, marginTop: 3 },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: BRD_T },
  dividerText: { marginHorizontal: 14, color: SUB_T, fontSize: 13 },

  previewImg: { width: '100%', height: 300, borderRadius: 16 },
  changeOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.32)',
    borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
    paddingVertical: 10, alignItems: 'center',
  },
  changeOverlayText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  // Crédits
  creditsRow:         { alignItems: 'center', marginBottom: 14 },
  creditsChip:        { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: CARD_T, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: ACC_T + '60' },
  creditsChipEmpty:   { borderColor: BRD_T },
  creditsChipText:    { fontSize: 12, fontWeight: '700', color: ACC_T },
  creditsChipTextEmpty: { color: SUB_T },

  // Plus de crédits
  noCreditsCard:  { backgroundColor: CARD_T, borderRadius: 16, padding: 18, marginBottom: 14, alignItems: 'center', gap: 8 },
  noCreditsTitle: { fontWeight: '800', fontSize: 15, color: PRI_T },
  noCreditsText:  { fontSize: 13, lineHeight: 18, textAlign: 'center', color: SUB_T },
  noCreditsBtn:   { backgroundColor: ACC_T, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  noCreditsBtnText: { color: "#1a0a10", fontWeight: '700', fontSize: 13 },

  // Bouton analyser
  analyzeBtn: {
    backgroundColor: ACC_T,
    borderRadius: 16, padding: 16,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    shadowColor: ACC_T,
    shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  analyzeBtnDisabled: { opacity: 0.75 },
  analyzeBtnInner:    { flexDirection: 'row', alignItems: 'center' },
  analyzeBtnText:     { color: "#1a0a10", fontWeight: '700', fontSize: 16 },

  // Carte conseil
  tipCard: {
    backgroundColor: TIP_T,
    borderRadius: 18, padding: 16,
    flexDirection: 'row', alignItems: 'center',
    gap: 12, marginBottom: 26,
  },
  tipIconWrap: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
  },
  tipTexts: { flex: 1 },
  tipTitle: { fontWeight: '800', fontSize: 14, color: ACC_T, marginBottom: 3 },
  tipHeart: { fontSize: 12 },
  tipBody:  { fontSize: 12.5, lineHeight: 17, color: SUB_T },

  // Comment ça marche
  howTitle: { fontSize: 17, fontWeight: '800', color: PRI_T, marginBottom: 14, textAlign: 'center' },
  howRow:   { flexDirection: 'row', gap: 10 },
  howCard:  {
    flex: 1, backgroundColor: CARD_T, borderRadius: 18, padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  howIconCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: TIP_T,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  howCardTitle: { fontSize: 12, fontWeight: '800', color: PRI_T, marginBottom: 6, textAlign: 'center' },
  howText:  { fontSize: 10.5, lineHeight: 14, textAlign: 'center', color: SUB_T },

  // APRÈS — en-tête
  afterHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  afterHeaderLeft: { flex: 1, paddingRight: 12 },
  searchBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: CARD_T, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
    elevation: 2, marginTop: 2,
  },

  // Photo analysée (état résultat)
  resultPhoto: { width: '100%', height: 300, borderRadius: 18, marginBottom: 16, backgroundColor: BRD_T },

  // Cartes critères
  criterionRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  criterionCard: {
    flex: 1, backgroundColor: CARD_T, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 8,
    alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  criterionName:  { fontSize: 12, fontWeight: '700', color: PRI_T, marginBottom: 8 },
  criterionLabel: { fontSize: 11, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  criterionDesc:  { fontSize: 9.5, color: SUB_T, marginTop: 3, textAlign: 'center', lineHeight: 12.5 },

  // Note globale
  globalCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD_T, borderRadius: 18, padding: 16, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  globalLeft:      { alignItems: 'flex-start', paddingRight: 14 },
  globalCardTitle: { fontSize: 12, color: SUB_T, marginBottom: 2, fontWeight: '600' },
  globalScoreRow:  { flexDirection: 'row', alignItems: 'flex-end' },
  globalScore:     { fontSize: 38, fontWeight: '800', color: ACC_T, lineHeight: 42 },
  globalSub:       { fontSize: 13, color: SUB_T, marginBottom: 6 },
  globalDivider:   { width: 1, alignSelf: 'stretch', backgroundColor: BORDER, marginVertical: 2 },
  globalRight:     { flex: 1, paddingLeft: 14, paddingRight: 8 },
  globalMessage:   { fontSize: 14, fontWeight: '800', color: PRI_T, marginBottom: 2 },
  globalMessageSub:{ fontSize: 11.5, color: SUB_T, lineHeight: 15 },
  globalStarBadge: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: ACC_T,
    alignItems: 'center', justifyContent: 'center',
  },

  // Conseil
  conseilCard: {
    backgroundColor: TIP_T, borderRadius: 18, padding: 16,
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16,
  },
  conseilEmoji:  { fontSize: 34 },
  conseilTexts:  { flex: 1 },
  conseilTitle:  { fontSize: 13.5, fontWeight: '800', color: PRI_T, marginBottom: 4 },
  conseilBody:         { fontSize: 12.5, lineHeight: 18, color: SUB_T },
  conseilSectionTitle: { fontSize: 11.5, fontWeight: '800', color: PRI_T, marginTop: 4, marginBottom: 5, letterSpacing: 0.3 },
  conseilBullet:       { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4, gap: 7 },
  conseilBulletDot:    { fontSize: 11, lineHeight: 18, color: ACC_T, width: 12 },
  conseilBulletText:   { fontSize: 12.5, lineHeight: 18, color: SUB_T, flex: 1 },

  // Top OOTDs
  topSection: { marginBottom: 16 },
  topHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  topTitle:   { fontSize: 15, fontWeight: '800', color: PRI_T },
  topSeeAll:  { fontSize: 12, fontWeight: '700', color: ACC_T },
  topItem:    { marginRight: 10, position: 'relative' },
  topImg:     { width: 86, height: 112, borderRadius: 14 },
  topHeartChip: {
    position: 'absolute', bottom: 6, left: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2.5,
  },
  topHeartText: { fontSize: 10, fontWeight: '800', color: PRI_T },

  // Actions
  actionsCard: {
    backgroundColor: CARD_T, borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  captionInput: {
    backgroundColor: BG_T, borderRadius: 12, padding: 14, fontSize: 14,
    marginBottom: 12, borderWidth: 1, borderColor: BRD_T,
    minHeight: 72, textAlignVertical: 'top', color: PRI_T,
  },
  actionPrimary: {
    backgroundColor: ACC_T, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  actionPrimaryText: { color: "#1a0a10", fontWeight: '800', fontSize: 14 },
  actionSecondary: {
    borderWidth: 1.5, borderColor: ACC_T, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    backgroundColor: CARD_T,
  },
  actionSecondaryText: { color: ACC_T, fontWeight: '700', fontSize: 14 },
  actionDisabled: { opacity: 0.55 },
  retryBtn:  { alignItems: 'center', paddingVertical: 10 },
  retryText: { fontSize: 13, fontWeight: '600', color: SUB_T },

  /* Musique */
  musicBtn:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: ACC_T + '55', marginBottom: 10 },
  musicBtnText:      { fontSize: 14, fontWeight: '700', color: ACC_T },
  musicChip:         { flexDirection: 'row', alignItems: 'center', backgroundColor: ACC_T + '18', borderRadius: 12, padding: 10, marginBottom: 10, gap: 10 },
  musicChipCover:    { width: 42, height: 42, borderRadius: 8 },
  musicChipNote:     { width: 42, height: 42, borderRadius: 8, textAlign: 'center', lineHeight: 42, fontSize: 22, backgroundColor: ACC_T + '33' },
  musicChipInfo:     { flex: 1 },
  musicChipTitle:    { fontWeight: '700', fontSize: 13, color: PRI_T },
  musicChipArtist:   { fontSize: 12, color: SUB_T, marginTop: 2 },
  musicChipRemove:   { fontSize: 16, color: SUB_T, paddingHorizontal: 4 },
  musicSheet:        { backgroundColor: CARD_T, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '80%' },
  musicSearchInput:  { backgroundColor: BG_T, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 10, borderWidth: 1, borderColor: BRD_T, color: PRI_T },
  musicResultsList:  { maxHeight: 320 },
  musicResultRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BRD_T},
  musicResultCover:  { width: 48, height: 48, borderRadius: 8 },
  musicResultInfo:   { flex: 1 },
  musicResultTitle:  { fontWeight: '700', fontSize: 13, color: PRI_T },
  musicResultArtist: { fontSize: 12, color: SUB_T, marginTop: 2 },
  musicResultBadge:  { backgroundColor: ACC_T + '22', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, fontSize: 11, fontWeight: '700', color: ACC_T },
  musicNoResults:    { textAlign: 'center', color: SUB_T, marginVertical: 16, fontSize: 13 },

  /* Picker flammes */
  pickerOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  pickerSheet:     { backgroundColor: CARD_T, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 36, maxHeight: '75%' },
  pickerHandle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: 16 },
  pickerTitle:     { fontWeight: '800', fontSize: 18, color: PRI_T, textAlign: 'center', marginBottom: 4 },
  pickerSub:       { fontSize: 13, color: SUB_T, textAlign: 'center', marginBottom: 16 },
  pickerList:      { maxHeight: 320 },
  pickerRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  pickerAvatar:    { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pickerAvatarImg: { width: 44, height: 44, borderRadius: 22 },
  pickerAvatarText:{ color: '#fff', fontWeight: '700', fontSize: 17 },
  pickerName:      { flex: 1, fontWeight: '600', fontSize: 15, color: PRI_T },
  checkbox:        { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: BRD_T, alignItems: 'center', justifyContent: 'center' },
  checkboxOn:      { backgroundColor: ACC_T, borderColor: ACC_T },
  checkmark:       { color: '#fff', fontWeight: '900', fontSize: 13 },
  pickerBtns:      { flexDirection: 'row', gap: 10, marginTop: 16 },
  pickerCancel:    { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', backgroundColor: BRD_T},
  pickerCancelText:{ fontWeight: '600', fontSize: 15, color: PRI_T },
  pickerConfirm:   { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', backgroundColor: ACC_T },
  pickerConfirmText:{ fontWeight: '800', fontSize: 15, color: '#fff' },

  /* Post-analyse actions */
  postAnalysisActions: { gap: 10, marginTop: 20, marginBottom: 4 },

  /* Conseil contextuel */
  contextBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, backgroundColor: ACC_T, borderRadius: 16, marginTop: 12, marginBottom: 4, justifyContent: 'center', shadowColor: ACC_T, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  contextBtnText: { fontSize: 16, fontWeight: '700', color: '#1a0a10' },
  contextPanel: { backgroundColor: CARD_T, borderRadius: 18, padding: 16, marginTop: 4, marginBottom: 4, borderWidth: 1, borderColor: BRD_T },
  contextLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: SUB_T, marginBottom: 8 },
  contextInput: { borderRadius: 10, borderWidth: 1, borderColor: BRD_T, backgroundColor: BG_T, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: PRI_T, minHeight: 56, textAlignVertical: 'top' },
  contextAnalyzeBtn: { borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginTop: 10, backgroundColor: ACC_T },
  contextResultCard: { marginTop: 14, borderRadius: 14, borderWidth: 1.5, padding: 14 },
  contextBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 10 },
  contextBadgeText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  contextExplication: { fontSize: 13, color: PRI_T, lineHeight: 19, marginBottom: 6 },
  contextConseil: { fontSize: 12, color: SUB_T, lineHeight: 17, fontStyle: 'italic', marginBottom: 6 },
  contextAltBlock: { marginTop: 4, borderRadius: 10, borderWidth: 1, borderColor: BRD_T, backgroundColor: BG_T, padding: 10 },
  contextAltLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, color: SUB_T, marginBottom: 3 },
  contextAltText: { fontSize: 12, color: PRI_T, lineHeight: 17 },

  /* Section Stories */
  storiesSection:    { marginTop: 28, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BRD_T },
  storiesSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  storiesSectionTitle:  { fontWeight: '800', fontSize: 17, color: PRI_T, flex: 1 },
  storiesSectionSub:    { fontSize: 12, color: SUB_T },

  myStoryPreview:    { borderRadius: 20, overflow: 'hidden', height: 200, marginBottom: 14, position: 'relative' },
  myStoryThumb:      { width: '100%', height: '100%' },
  myStoryOverlay:    { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 14, backgroundColor: 'rgba(0,0,0,0.32)' },
  myStoryOverlayText:{ color: '#fff', fontWeight: '700', fontSize: 14 },
  storyActiveBadge:  { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  storyActiveDot:    { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  storyActiveTxt:    { color: '#fff', fontSize: 11, fontWeight: '700' },

  storyPublishBtn:   { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18, borderRadius: 20, borderWidth: 1.5, borderColor: ACC_T + '44', borderStyle: 'dashed' },
  storyPublishGradient: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  storyPublishTitle: { fontWeight: '700', fontSize: 15, color: PRI_T },
  storyPublishSub:   { fontSize: 12, color: SUB_T, marginTop: 2 },

  /* Story viewer */
  viewerOverlay:  { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  viewerHeader:   { position: 'absolute', top: 56, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, zIndex: 10 },
  viewerUsername: { color: '#fff', fontWeight: '700', fontSize: 16 },
  viewerMedia:    { width: '100%', height: '70%' },
  viewerTextWrap: { position: 'absolute', bottom: 140, left: 20, right: 20, alignItems: 'center' },
  viewerText:     { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  replaceStoryBtn:    { position: 'absolute', bottom: 60, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 22, backgroundColor: ACC_T },
  replaceStoryBtnText:{ color: '#3a0d1e', fontWeight: '800', fontSize: 14 },

  /* Story preview modal */
  storyModalOverlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  storyModalSheet:      { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 },
  storyModalHandle:     { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  storyModalTitle:      { fontSize: 17, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  storyVideoWrap:       { borderRadius: 16, overflow: 'hidden', height: 200, marginBottom: 20, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  storyVideoPreview:    { width: '100%', height: '100%' },
  storyFieldLabel:      { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  storyFieldInput:      { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, marginBottom: 14, borderWidth: 1 },
  storyFieldInputMulti: { minHeight: 72, textAlignVertical: 'top' },
  storyModalBtns:       { flexDirection: 'row', gap: 10, marginTop: 4 },
  storyModalCancel:     { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  storyModalCancelText: { fontWeight: '600', fontSize: 15 },
  storyModalPublish:    { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  storyModalPublishText:{ color: '#3a0d1e', fontWeight: '800', fontSize: 15 },
  });
}
