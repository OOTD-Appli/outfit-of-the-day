import { supabase } from '../lib/supabase';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode } from 'base64-arraybuffer';
import {
  View, Text, StyleSheet, ScrollView, Animated, Easing,
  Alert, TouchableOpacity, ActivityIndicator,
  useWindowDimensions, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';
import { ENV } from '../lib/env';
import { resolveTier } from '../lib/tier';
import { setPendingOutfit } from '../lib/pendingOutfit';
import MediaCropEditor from '../components/MediaCropEditor';

// Ratio de recadrage 9:16, repris de l'ancien components/StoryMedia.js (supprimé
// avec les Stories) — encore utilisé ici pour le crop de la photo de tenue.
const CROP_ASPECT = 9 / 16;
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

// Seuils proportionnels à l'ancienne échelle /10 (8→26, 6→20, 4→13 sur un max de 33 ;
// 8→27, 6→20, 4→14 sur un max de 34) — mêmes ratios, juste recalibrés sur la note /100 (v3).
const CRITERION_META = {
  fit: {
    icon: 'shirt-outline', name: 'Fit', color: '#ED93B1', track: '#F8E5EC', max: 33,
    labels: [
      [26, 'Ajustement parfait !'],
      [20, 'Bonne silhouette'],
      [13, 'À ajuster'],
      [0, 'Coupes à rééquilibrer'],
    ],
    descs: [
      [26, "Les volumes et proportions valorisent parfaitement ta silhouette."],
      [20, "La coupe est équilibrée, quelques ajustements pourraient l'affiner."],
      [13, "L'équilibre des volumes et des longueurs mérite attention."],
      [0, "Les proportions et coupes gagneraient à être repensées."],
    ],
  },
  harmonie: {
    icon: 'color-palette-outline', name: 'Harmonie', color: '#B0809A', track: '#EFE3EA', max: 34,
    labels: [
      [27, 'Palette maîtrisée !'],
      [20, 'Bon accord couleurs & matières'],
      [14, 'Quelques contrastes à harmoniser'],
      [0, 'Combinaison à rééquilibrer'],
    ],
    descs: [
      [27, "Couleurs et matières se complètent avec élégance."],
      [20, "L'accord chromatique fonctionne, les textures peuvent s'affiner."],
      [14, "Certaines couleurs ou matières créent une légère dissonance."],
      [0, "La palette et les matières manquent de cohérence."],
    ],
  },
  detail: {
    icon: 'sparkles-outline', name: 'Détails', color: '#C9A47A', track: '#F1E8DC', max: 33,
    labels: [
      [26, 'Styling soigné !'],
      [20, 'Bons accessoires & finitions'],
      [13, 'Des détails à ajouter'],
      [0, 'Finitions à soigner'],
    ],
    descs: [
      [26, "Les accessoires et finitions élèvent la tenue au niveau supérieur."],
      [20, "Les détails renforcent le style, quelques ajouts sublimeront l'ensemble."],
      [13, "L'outfit manque d'une touche finale pour se démarquer."],
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
                    <View style={s.conseilBulletDot} accessibilityElementsHidden />
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
                    <View style={[s.conseilBulletDot, s.conseilBulletArrow]} accessibilityElementsHidden />
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

// Seuils note sur 100 (v3) : 90/70/50/30, mêmes proportions que les anciens 9/7/5/3 sur 10.
function globalMessage(value) {
  if (value >= 90) return 'Tu as un style de fou !';
  if (value >= 70) return 'Très bon look !';
  if (value >= 50) return 'Pas mal, il y a moyen de peaufiner !';
  if (value >= 30) return 'Quelques efforts à faire sur cette tenue.';
  return 'On retente une tenue différente ?';
}

function fr(value) {
  return typeof value === 'number' ? String(Math.round(value)) : '-';
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
  const [photoIncomplete, setPhotoIncomplete] = useState(null); // raison, ou null
  const [loading, setLoading] = useState(false);
  const [continuingToShare, setContinuingToShare] = useState(false);
  const [selectedMusic, setSelectedMusic] = useState(null); // { title, artist, previewUrl, coverUrl }
  const [showCustomization, setShowCustomization] = useState(false);
  const [showStyleHashtag, setShowStyleHashtag] = useState(true);
  const [visibleScores, setVisibleScores] = useState([]); // clés de notes affichées sur le post
  const [musicPicker, setMusicPicker] = useState({ visible: false, query: '', results: [], searching: false });
  const musicSearchTimeout = useRef(null);
  useEffect(() => () => {
    if (musicSearchTimeout.current) clearTimeout(musicSearchTimeout.current);
  }, []);
  const [caption, setCaption] = useState('');
  const [credits, setCredits] = useState(null);
  const [maxCredits, setMaxCredits] = useState(2);
  const [unlimited, setUnlimited] = useState(false);
  const [analysisPersonality, setAnalysisPersonality] = useState('coach');
  const [userTier, setUserTier] = useState('free');
  const [highScoreReminder, setHighScoreReminder] = useState(null); // { note } | null
  const [showLowCreditsReminder, setShowLowCreditsReminder] = useState(false);
  const [topOotds, setTopOotds] = useState([]);
  // Compétitions
  const [competitions, setCompetitions] = useState([]);
  const [competitionsLoading, setCompetitionsLoading] = useState(true);
  const [outfitCrop, setOutfitCrop] = useState({ visible: false, uri: null });
  // Caméra in-app (native uniquement — web garde le fallback file-input)
  const [inAppCamera, setInAppCamera] = useState({ visible: false, mode: 'photo' });
  const { showToast } = useToast();
  const cachedPublicUrlRef = useRef(null);
  const lastAnalyzedRef = useRef({ uri: null, ts: 0 });
  const resultFade = useRef(new Animated.Value(0)).current;
  const resultRise = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    if (!score) {
      resultFade.setValue(0);
      resultRise.setValue(14);
      return;
    }
    Animated.parallel([
      Animated.timing(resultFade, {
        toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.timing(resultRise, {
        toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
    ]).start();
  }, [score, resultFade, resultRise]);

  const fetchCredits = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data }, { data: sub }] = await Promise.all([
      supabase
        .from('profiles')
        .select('daily_credits, credits_reset_date, has_analysis_pass, has_ootd_plus_pass, analysis_personality')
        .eq('id', user.id)
        .single(),
      supabase
        .from('subscriptions')
        .select('status, plan_type')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    if (!data) return;
    setAnalysisPersonality(data.analysis_personality || 'coach');

    // Tier : Elite (abonnement) = illimité · Plus (abonnement) ou pass legacy = 20 · sinon 2
    const tier = resolveTier({ subscription: sub, hasPlus: data.has_ootd_plus_pass, hasAnalysis: data.has_analysis_pass });
    setUserTier(tier);

    if (tier === 'elite') {
      setUnlimited(true);
      setMaxCredits(Infinity);
      setCredits(Infinity);
      return;
    }

    setUnlimited(false);
    const max = tier === 'plus' ? 20 : 2;
    setMaxCredits(max);
    const today = new Date().toISOString().split('T')[0];
    const effective = data.credits_reset_date < today ? max : data.daily_credits;
    setCredits(effective);
  }, []);

  const fetchCompetitions = useCallback(async () => {
    setCompetitionsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('competition_members')
        .select('last_read_at, competitions(id, name, created_at)')
        .eq('user_id', user.id)
        .order('competitions(created_at)', { ascending: false });
      if (error) throw error;
      const rows = (data || []).filter(r => r.competitions);
      const withUnread = await Promise.all(rows.map(async (r) => {
        const { count } = await supabase
          .from('competition_messages')
          .select('*', { count: 'exact', head: true })
          .eq('competition_id', r.competitions.id)
          .gt('created_at', r.last_read_at)
          .neq('sender_id', user.id);
        return { ...r.competitions, unread: count || 0 };
      }));
      setCompetitions(withUnread);
    } catch (_) {
      // silencieux : la liste des compétitions n'est pas critique au chargement
    }
    setCompetitionsLoading(false);
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

  // Rappel n°2 (Cahier des charges Monétisation 2026-08-12) : dernière analyse du
  // jour, gratuit uniquement, 1x/jour max — AsyncStorage plutôt que DB (pur throttle
  // d'affichage local, pas une donnée métier à synchroniser entre appareils).
  // Rendu en carte (pas en toast) : le toast de l'app n'a pas de CTA cliquable
  // (pointerEvents: 'none'), or ce rappel exige un chemin direct vers le Shop.
  useEffect(() => {
    if (userTier !== 'free' || credits !== 1) { setShowLowCreditsReminder(false); return; }
    let cancelled = false;
    (async () => {
      const todayKey = new Date().toISOString().split('T')[0];
      const lastShown = await AsyncStorage.getItem('@ootd_reminder_lastcredit_date');
      if (cancelled || lastShown === todayKey) return;
      setShowLowCreditsReminder(true);
      AsyncStorage.setItem('@ootd_reminder_lastcredit_date', todayKey);
    })();
    return () => { cancelled = true; };
  }, [userTier, credits]);

  // Rappel n°3 : note ≥ 80/100, gratuit + Plus uniquement (jamais Elite, déjà tout
  // débloqué), 1x tous les 3 jours max.
  const maybeShowHighScoreReminder = useCallback(async (globalScore) => {
    if (userTier === 'elite' || typeof globalScore !== 'number' || globalScore < 80) return;
    const THREE_DAYS_MS = 3 * 24 * 3600 * 1000;
    const lastShownRaw = await AsyncStorage.getItem('@ootd_reminder_highscore_ts');
    const lastShown = lastShownRaw ? Number(lastShownRaw) : 0;
    if (Date.now() - lastShown < THREE_DAYS_MS) return;
    setHighScoreReminder({ note: globalScore });
    AsyncStorage.setItem('@ootd_reminder_highscore_ts', String(Date.now()));
  }, [userTier]);

  useFocusEffect(useCallback(() => {
    fetchCredits();
    fetchTopOotds();
    fetchCompetitions();
  }, [fetchCredits, fetchTopOotds, fetchCompetitions]));

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
    setPhotoIncomplete(null);
    setHighScoreReminder(null);
    cachedPublicUrlRef.current = null;
    setVisibleScores([]);
    setImage(asset);
  };

  const toggleScoreVisibility = (dbKey) => {
    setVisibleScores(prev =>
      prev.includes(dbKey) ? prev.filter(k => k !== dbKey) : [...prev, dbKey],
    );
  };

  // Web : capture via <input type=file>. `capture="environment"` ouvre l'appareil
  // photo (arrière) sur mobile. On compresse via canvas et on renvoie le base64
  // BRUT (analyzeOutfit reconstruit la data-URL `data:image/jpeg;base64,...`).
  // Le redimensionnement + double encodage (JPEG analyse / WebP stockage) sont
  // maintenant faits par MediaCropEditor (bakeCropWeb) au moment de valider le
  // recadrage — ici on se contente de récupérer le fichier brut et d'ouvrir l'éditeur.
  const pickImageWeb = (useCamera) => {
    if (typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (useCamera) input.setAttribute('capture', 'environment');
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      setOutfitCrop({ visible: true, uri: URL.createObjectURL(file) });
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
      setOutfitCrop({ visible: true, uri: result.assets[0].uri });
    }
  };

  const onOutfitCropConfirm = (result) => {
    setOutfitCrop({ visible: false, uri: null });
    if (result.mode === 'baked') applyPickedImage(result.asset);
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
        supabase.functions.invoke("analyze-outfit", { body: { base64Image, personality: analysisPersonality } }),
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
      if (parsed?.photo_complete === false) {
        // Aucun crédit consommé côté serveur dans ce cas — juste un message
        // clair + possibilité de reprendre une photo, pas un échec d'analyse.
        setPhotoIncomplete(parsed.raison_incomplete || 'Photo incomplète : reprends une photo qui montre ta tenue en entier, des épaules aux genoux minimum.');
        setLoading(false);
        return;
      }
      if (!parsed || typeof parsed.global !== "number") throw new Error("Reponse IA invalide, reessaie.");
      setPhotoIncomplete(null);
      if (parsed.max_credits === -1 || parsed.credits_remaining === -1) {
        setUnlimited(true);
        setCredits(Infinity);
        setMaxCredits(Infinity);
      } else {
        if (typeof parsed.credits_remaining === "number") setCredits(parsed.credits_remaining);
        if (typeof parsed.max_credits === "number") setMaxCredits(parsed.max_credits);
      }
      cachedPublicUrlRef.current = null;
      lastAnalyzedRef.current = { uri: image.uri, ts: Date.now() };
      setScore(parsed);
      maybeShowHighScoreReminder(parsed.global);
    } catch (e) {
      showToast(e.message || "Une erreur est survenue pendant l'analyse.", { type: "error" });
      console.log("analyzeOutfit error:", e);
    }
    setLoading(false);
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

  // Upload l'image puis stocke la tenue en attente pour ShareToCompetitionScreen
  // (multi-sélection compétitions + toggle "rendre publique"). Remplace les
  // anciens publishToFeed/saveForSelf/sendOutfitToSelectedFlammes : un seul
  // point d'entrée, l'insert réel se fait via submit_ootd_to_competitions
  // dans ShareToCompetitionScreen.
  const goToShareToCompetition = async () => {
    if (!score || continuingToShare) return;
    setContinuingToShare(true);
    try {
      const publicUrl = await uploadAnalyzedImageIfNeeded();
      setPendingOutfit({
        imageUrl: publicUrl,
        score,
        caption: caption.trim(),
        showStyleHashtag,
        visibleScores,
        music: selectedMusic,
      });
      setShowCustomization(false);
      navigation.navigate('ShareToCompetition');
    } catch (e) {
      showToast(e?.message || 'Erreur inconnue', { type: 'error' });
    }
    setContinuingToShare(false);
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
                  <ExpoImage source={{ uri: image.uri }} style={s.previewImg} contentFit="cover" />
                  <View style={s.changeOverlay}>
                    <Text style={s.changeOverlayText}>Changer la photo</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={s.uploadOption} onPress={takePicture} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Prendre une photo">
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

                  <TouchableOpacity style={s.uploadOption} onPress={pickImageFromLibrary} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Choisir dans la galerie">
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
                  onPress={() => navigation.navigate('Récap', { screen: 'Shop' })}
                  activeOpacity={0.85}
                >
                  <Text style={s.noCreditsBtnText}>Obtenir plus de crédits →</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Rappel n°2 : dernière analyse du jour (gratuit, 1x/jour) */}
            {!unlimited && credits === 1 && showLowCreditsReminder && (
              <View style={s.noCreditsCard}>
                <Text style={s.noCreditsTitle}>⚡ Dernière analyse du jour !</Text>
                <Text style={s.noCreditsText}>
                  Passe à OOTD Plus pour ne jamais être à court d'analyses.
                </Text>
                <TouchableOpacity
                  style={s.noCreditsBtn}
                  onPress={() => navigation.navigate('Récap', { screen: 'Shop' })}
                  activeOpacity={0.85}
                >
                  <Text style={s.noCreditsBtnText}>Découvrir Plus →</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Bouton analyser */}
            {image && credits !== 0 && (
              <Bouncy
                style={[s.analyzeBtn, (loading || credits === null) && s.analyzeBtnDisabled]}
                onPress={analyzeOutfit}
                disabled={loading || credits === null}
                accessibilityRole="button"
                accessibilityLabel={loading ? 'Analyse en cours' : 'Analyser ma tenue'}
                accessibilityState={{ disabled: !!(loading || credits === null) }}
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

            {/* Photo incomplète (v3) : aucun crédit consommé, juste une invite à reprendre */}
            {photoIncomplete && (
              <View style={s.tipCard}>
                <View style={s.tipIconWrap}>
                  <Ionicons name="camera-reverse-outline" size={20} color={theme.accent} />
                </View>
                <View style={s.tipTexts}>
                  <Text style={s.tipTitle}>Photo incomplète</Text>
                  <Text style={s.tipBody}>{photoIncomplete}</Text>
                  <TouchableOpacity onPress={openImageSourcePicker} style={{ marginTop: 8 }} activeOpacity={0.8}>
                    <Text style={{ color: theme.accent, fontWeight: '700', fontSize: 13 }}>Reprendre la photo</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}


            {/* Conseil compact — laisse la place à "Mes compétitions" en dessous */}
            <View style={s.tipCardCompact}>
              <Ionicons name="bulb-outline" size={15} color={theme.accent} />
              <Text style={s.tipBodyCompact} numberOfLines={1}>
                Bonne lumière + tenue entière = meilleure analyse
              </Text>
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
              <ExpoImage source={{ uri: image.uri }} style={s.resultPhoto} contentFit="cover" />
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
                    <Gauge value={val} max={meta.max} size={ringSize} thickness={Math.round(ringSize * 0.1)} color={meta.color} track={meta.track} textColor={theme.textPri} />
                    <Text style={[s.criterionLabel, { color: meta.color }]}>{criterionLabel(meta, val)}</Text>
                    <Text style={s.criterionDesc}>{criterionDesc(meta, val)}</Text>
                  </View>
                );
              })}
            </View>

            {/* Note globale */}
            <View style={s.globalCard}>
              <View style={s.globalLeft}>
                <View style={s.tipTitleRow}>
                  <Text style={s.globalCardTitle}>Note globale</Text>
                  <Ionicons name="heart-outline" size={13} color={ACCENT} accessibilityElementsHidden />
                </View>
                <View style={s.globalScoreRow}>
                  <Text style={s.globalScore}>{fr(score.global)}</Text>
                  <Text style={s.globalSub}> /100</Text>
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
                        <ExpoImage source={{ uri: ootd.image_url }} style={s.topImg} contentFit="cover" recyclingKey={ootd.id} />
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

            {/* Rappel n°3 : note ≥ 80/100 (gratuit + Plus, jamais Elite) */}
            {highScoreReminder && (
              <View style={s.noCreditsCard}>
                <Text style={s.noCreditsTitle}>🔥 {highScoreReminder.note}/100, sérieux !</Text>
                <Text style={s.noCreditsText}>
                  Débloque le mode IA Sévère et plus d'analyses comme celle-ci avec OOTD Plus.
                </Text>
                <TouchableOpacity
                  style={s.noCreditsBtn}
                  onPress={() => navigation.navigate('Récap', { screen: 'Shop' })}
                  activeOpacity={0.85}
                >
                  <Text style={s.noCreditsBtnText}>Voir les offres →</Text>
                </TouchableOpacity>
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
                  setHighScoreReminder(null);
                  cachedPublicUrlRef.current = null;
                }}
              >
                <Text style={s.retryText}>Analyser une nouvelle tenue</Text>
              </TouchableOpacity>
            </View>

          </Animated.View>
        )}

        {/* ===== MES COMPÉTITIONS (toujours visible en scrollant) ===== */}
        <View style={s.storiesSection}>
          <View style={s.storiesSectionHeader}>
            <Ionicons name="trophy-outline" size={16} color={ACCENT} />
            <Text style={s.storiesSectionTitle}>Mes compétitions</Text>
          </View>

          {competitionsLoading ? (
            <ActivityIndicator color={ACCENT} style={{ marginVertical: 12 }} />
          ) : competitions.length === 0 ? (
            <Text style={{ color: TEXT_SEC, fontSize: 13, marginBottom: 10 }}>
              Aucune compétition pour l'instant.
            </Text>
          ) : (
            competitions.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={s.competitionRow}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('Competition', { competitionId: c.id, competitionName: c.name })}
              >
                <View style={s.competitionIconWrap}>
                  <Ionicons name="people" size={18} color={ACCENT} />
                </View>
                <Text style={s.competitionName} numberOfLines={1}>{c.name}</Text>
                {c.unread > 0 && (
                  <View style={s.competitionUnreadDot}>
                    <Text style={s.competitionUnreadText}>{c.unread > 9 ? '9+' : c.unread}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={18} color={TEXT_SEC} />
              </TouchableOpacity>
            ))
          )}

          <TouchableOpacity
            style={s.createCompetitionBtn}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('CreateCompetition')}
          >
            <Ionicons name="add-circle-outline" size={18} color={ACCENT} />
            <Text style={s.createCompetitionText}>Créer une compétition</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* Caméra in-app (photo tenue) */}
      <InAppCamera
        visible={inAppCamera.visible}
        mode={inAppCamera.mode}
        onClose={() => setInAppCamera(prev => ({ ...prev, visible: false }))}
        onCapture={(asset) => {
          setInAppCamera(prev => ({ ...prev, visible: false }));
          if (asset?.uri) setOutfitCrop({ visible: true, uri: asset.uri });
        }}
      />
      <MediaCropEditor
        visible={outfitCrop.visible}
        uri={outfitCrop.uri}
        mediaType="image"
        aspect={CROP_ASPECT}
        onCancel={() => setOutfitCrop({ visible: false, uri: null })}
        onConfirm={onOutfitCropConfirm}
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
        onContinue={goToShareToCompetition}
        continuing={continuingToShare}
        showStyleHashtag={showStyleHashtag}
        setShowStyleHashtag={setShowStyleHashtag}
        visibleScores={visibleScores}
        onToggleScore={toggleScoreVisibility}
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
  analyzeBtnDisabled: { opacity: 0.42 },
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
  tipTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 },
  tipTitle: { fontWeight: '800', fontSize: 14, color: ACC_T },
  tipHeart: { fontSize: 12 },
  tipBody:  { fontSize: 12.5, lineHeight: 17, color: SUB_T },

  // Conseil compact (remplace l'ancien bloc "Conseil" + "Comment ça marche" —
  // moins de place prise, plus de place pour "Mes compétitions" en dessous)
  tipCardCompact: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    marginBottom: 14,
  },
  tipBodyCompact: { fontSize: 11.5, color: SUB_T, flex: 1 },

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
  conseilBulletDot:    { width: 5, height: 5, borderRadius: 2.5, backgroundColor: ACC_T, marginTop: 6.5 },
  conseilBulletArrow:  { width: 8, height: 2, borderRadius: 1, marginTop: 8 },
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
  actionDisabled: { opacity: 0.42 },
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

  /* Post-analyse actions */
  postAnalysisActions: { gap: 10, marginTop: 20, marginBottom: 4 },

  /* Section Stories */
  storiesSection:    { marginTop: 28, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BRD_T },
  storiesSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  storiesSectionTitle:  { fontWeight: '800', fontSize: 17, color: PRI_T, flex: 1 },

  /* Section Compétitions */
  competitionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: CARD_T, borderRadius: 16, borderWidth: 1, borderColor: BRD_T, padding: 14, marginBottom: 10 },
  competitionIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: ACCENT + '1A', alignItems: 'center', justifyContent: 'center' },
  competitionName: { flex: 1, fontWeight: '700', fontSize: 14.5, color: PRI_T },
  competitionUnreadDot: { backgroundColor: ACCENT, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  competitionUnreadText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
  createCompetitionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: ACCENT, borderRadius: 16, paddingVertical: 13, marginTop: 4 },
  createCompetitionText: { color: ACCENT, fontWeight: '800', fontSize: 14 },
  });
}
