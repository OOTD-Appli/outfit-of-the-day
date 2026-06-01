import { supabase } from '../lib/supabase';
import {
  flammeOrderedIds,
  fetchAcceptedFriendIds,
  hasSnapUsedTodayForPair,
} from '../lib/flammesUtils';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { decode } from 'base64-arraybuffer';
import {
  View, Text, StyleSheet, ScrollView, Animated, Easing,
  Alert, TouchableOpacity, ActivityIndicator, Image, TextInput,
  useWindowDimensions, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useToast } from '../lib/toastContext';
import Gauge from '../components/Gauge';

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
    desc: 'Tes coupes mettent bien ta silhouette en valeur.',
    labels: [[8, 'Très bon fit !'], [6, 'Bon fit'], [0, 'Fit à retravailler']],
  },
  harmonie: {
    icon: 'color-palette-outline', name: 'Harmonie', color: '#B0809A', track: '#EFE3EA',
    desc: 'Les couleurs que tu choisis s’accordent bien ensemble.',
    labels: [[8, 'Belle harmonie !'], [6, 'Bonne harmonie'], [0, 'Harmonie à revoir']],
  },
  detail: {
    icon: 'sparkles-outline', name: 'Détails', color: '#C9A47A', track: '#F1E8DC',
    desc: 'Les accessoires ajoutent un petit plus à tes tenues.',
    labels: [[8, 'Jolis détails !'], [6, 'Bons détails'], [0, 'Détails à soigner']],
  },
};

function criterionLabel(meta, value) {
  for (const [threshold, text] of meta.labels) {
    if (value >= threshold) return text;
  }
  return '';
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

  const [image, setImage] = useState(null);
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [publishedToFeed, setPublishedToFeed] = useState(false);
  const [sentFlammesToAll, setSentFlammesToAll] = useState(false);
  const [postingFeed, setPostingFeed] = useState(false);
  const [sendingFlammesAll, setSendingFlammesAll] = useState(false);
  const [caption, setCaption] = useState('');
  const [credits, setCredits] = useState(null);
  const [maxCredits, setMaxCredits] = useState(2);
  const [unlimited, setUnlimited] = useState(false);
  const [topOotds, setTopOotds] = useState([]);
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
  }, [fetchCredits, fetchTopOotds]));

  const applyPickedImage = (asset) => {
    setScore(null);
    cachedPublicUrlRef.current = null;
    setPublishedToFeed(false);
    setSentFlammesToAll(false);
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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        applyPickedImage({ uri: dataUrl, base64: dataUrl.split(',')[1] || null, width, height });
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

  const takePicture = async () => {
    if (Platform.OS === 'web') { pickImageWeb(true); return; }
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showToast('Permission refusée pour accéder à la caméra', { type: 'warning' });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.75,
      allowsEditing: false,
      base64: true,
      cameraType: ImagePicker.CameraType.back,
    });
    if (!result.canceled) {
      applyPickedImage(result.assets[0]);
    }
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

  const uploadAnalyzedImageIfNeeded = useCallback(async () => {
    if (cachedPublicUrlRef.current) return cachedPublicUrlRef.current;
    if (!image?.base64) {
      throw new Error('Image introuvable. Reprends une photo.');
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Session expirée. Reconnecte-toi.');
    const fileName = `${user.id}/outfit_${Date.now()}.jpg`;
    const imageBuffer = decode(image.base64);
    const { error: uploadError } = await supabase.storage
      .from('ootds')
      .upload(fileName, imageBuffer, { contentType: 'image/jpeg' });
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
      }).select('id').single();
      if (insertError) throw new Error(`Publication impossible: ${insertError.message}`);
      const { data: awardResult, error: awardError } = await supabase.rpc('award_points_for_ootd', { p_ootd_id: insertData.id });
      if (awardError) throw new Error(`Points: ${awardError.message}`);
      if (!awardResult?.ok) throw new Error(awardResult?.error || 'Erreur attribution points');
      const pointsGagnes = awardResult.points_earned;
      setPublishedToFeed(true);
      setCaption('');
      showToast(`Ta tenue est dans le feed. +${pointsGagnes} points.`, { type: 'success' });
    } catch (e) {
      showToast(e?.message || 'Erreur inconnue', { type: 'error' });
    }
    setPostingFeed(false);
  };

  const sendOutfitToAllFlammes = async () => {
    if (!score || sentFlammesToAll || sendingFlammesAll) return;
    setSendingFlammesAll(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expirée. Reconnecte-toi.');
      const friendIds = await fetchAcceptedFriendIds(supabase, user.id);
      if (!friendIds.length) {
        Alert.alert(
          'Aucun ami',
          "Accepte des amis dans l'onglet Flammes pour leur envoyer ton outfit.",
        );
        setSendingFlammesAll(false);
        return;
      }
      const publicUrl = await uploadAnalyzedImageIfNeeded();
      const { data: myFlammes } = await supabase
        .from('flammes')
        .select('*')
        .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`);
      const flammesLocal = [...(myFlammes || [])];
      let sent = 0;
      let skipped = 0;
      for (const friendId of friendIds) {
        try {
          if (await hasSnapUsedTodayForPair(supabase, user.id, friendId)) {
            skipped += 1;
            continue;
          }
          const { error: snapErr } = await supabase.from('snaps').insert({
            sender_id: user.id,
            receiver_id: friendId,
            image_url: publicUrl,
          });
          if (snapErr) { console.error('snap insert failed:', snapErr); continue; }
          const { error: msgErr } = await supabase.from('messages').insert({
            sender_id: user.id,
            receiver_id: friendId,
            image_url: publicUrl,
          });
          if (msgErr) { console.error('messages insert failed:', msgErr); }
          sent += 1;
          const flamme = flammesLocal.find(
            (f) =>
              (f.user1_id === user.id && f.user2_id === friendId) ||
              (f.user1_id === friendId && f.user2_id === user.id),
          );
          const now = new Date();
          if (flamme) {
            const lastSnap = flamme.last_snap_at ? new Date(flamme.last_snap_at) : new Date(0);
            const diffHours = (now - lastSnap) / 3600000;
            const newStreak = diffHours < 24 ? flamme.streak + 1 : 1;
            await supabase.from('flammes').update({ streak: newStreak, last_snap_at: now.toISOString() }).eq('id', flamme.id);
            flamme.streak = newStreak;
            flamme.last_snap_at = now.toISOString();
          } else {
            const { data: ins, error: insErr } = await supabase
              .from('flammes')
              .insert({ ...flammeOrderedIds(user.id, friendId), streak: 1, last_snap_at: now.toISOString() })
              .select()
              .single();
            if (!insErr && ins) flammesLocal.push(ins);
            else if (insErr && insErr.code !== '23505') console.warn('flammes insert', insErr);
          }
        } catch (loopErr) {
          console.warn('flamme loop', loopErr);
        }
      }
      if (sent > 0) setSentFlammesToAll(true);
      const msg =
        sent > 0
          ? `${sent} ami(s) ont reçu ton outfit comme snap du jour.${skipped > 0 ? ` ${skipped} ignoré(s) (déjà un snap aujourd'hui).` : ''}`
          : skipped > 0
            ? "Aucun envoi : chaque ami avait déjà reçu ta photo flamme aujourd'hui (1 par jour)."
            : 'Aucun snap envoyé.';
      Alert.alert('Flammes', msg);
    } catch (e) {
      Alert.alert('Flammes', e?.message || 'Erreur inconnue');
    }
    setSendingFlammesAll(false);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ===== AVANT — pas encore de score ===== */}
        {!score && (
          <View>
            {/* En-tête */}
            <View style={s.beforeHeader}>
              <Text style={s.title}>Analyse ton OOTD ✨</Text>
              <Ionicons name="notifications-outline" size={22} color={TEXT_SEC} style={s.bellIcon} />
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
              <TouchableOpacity
                style={[s.analyzeBtn, (loading || credits === null) && s.analyzeBtnDisabled]}
                onPress={analyzeOutfit}
                disabled={loading || credits === null}
                activeOpacity={0.85}
              >
                {loading ? (
                  <View style={s.analyzeBtnInner}>
                    <ActivityIndicator color={BTN_TEXT} size="small" />
                    <Text style={s.analyzeBtnText}>  Analyse en cours...</Text>
                  </View>
                ) : (
                  <Text style={s.analyzeBtnText}>✨ Analyser ma tenue</Text>
                )}
              </TouchableOpacity>
            )}

            {/* Carte conseil */}
            <View style={s.tipCard}>
              <View style={s.tipIconWrap}>
                <Ionicons name="bulb-outline" size={20} color={ACCENT} />
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
                { icon: 'sparkles-outline',   title: '2. Analyse personnalisée',  text: 'Notre IA analyse ton look selon plusieurs critères de style et d’harmonie.' },
                { icon: 'star-outline',       title: '3. Reçois ton feedback',    text: 'Découvre ta note, des conseils et des astuces pour tes prochains looks !' },
              ].map((item, i) => (
                <View key={i} style={s.howCard}>
                  <View style={s.howIconCircle}>
                    <Ionicons name={item.icon} size={20} color={ACCENT} />
                  </View>
                  <Text style={s.howCardTitle}>{item.title}</Text>
                  <Text style={s.howText}>{item.text}</Text>
                </View>
              ))}
            </View>
          </View>
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
                <Ionicons name="search" size={18} color={TEXT_PRI} />
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
                    <Gauge value={val} size={ringSize} thickness={Math.round(ringSize * 0.1)} color={meta.color} track={meta.track} textColor={TEXT_PRI} />
                    <Text style={[s.criterionLabel, { color: meta.color }]}>{criterionLabel(meta, val)}</Text>
                    <Text style={s.criterionDesc}>{meta.desc}</Text>
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

            {/* Conseil */}
            <View style={s.conseilCard}>
              <Text style={s.conseilEmoji}>💁‍♀️</Text>
              <View style={s.conseilTexts}>
                <Text style={s.conseilTitle}>Conseil pour améliorer tes OOTD</Text>
                <Text style={s.conseilBody}>{score.conseil}</Text>
              </View>
            </View>

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
                          <Ionicons name="heart" size={10} color={ACCENT} />
                          <Text style={s.topHeartText}>{formatHearts(hearts)}</Text>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Actions */}
            <View style={s.actionsCard}>
              <TextInput
                style={s.captionInput}
                placeholder="Ajoute une description à ta tenue..."
                placeholderTextColor={TEXT_SEC}
                value={caption}
                onChangeText={setCaption}
                multiline
                maxLength={200}
              />

              <TouchableOpacity
                style={[s.actionPrimary, (publishedToFeed || postingFeed) && s.actionDisabled]}
                onPress={publishToFeed}
                disabled={publishedToFeed || postingFeed}
                activeOpacity={0.85}
              >
                {postingFeed ? (
                  <ActivityIndicator color={BTN_TEXT} size="small" />
                ) : (
                  <Text style={s.actionPrimaryText}>
                    {publishedToFeed ? '✓ Publié dans le feed' : '🏠 Publier dans le feed'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.actionSecondary, (sentFlammesToAll || sendingFlammesAll) && s.actionDisabled]}
                onPress={sendOutfitToAllFlammes}
                disabled={sentFlammesToAll || sendingFlammesAll}
                activeOpacity={0.85}
              >
                {sendingFlammesAll ? (
                  <ActivityIndicator color={ACCENT} size="small" />
                ) : (
                  <Text style={s.actionSecondaryText}>
                    {sentFlammesToAll ? '✓ Envoyé à tes flammes' : '🔥 Envoyer à mes flammes'}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={s.retryBtn}
                onPress={() => {
                  setImage(null);
                  setScore(null);
                  cachedPublicUrlRef.current = null;
                  setPublishedToFeed(false);
                  setSentFlammesToAll(false);
                }}
              >
                <Text style={s.retryText}>Analyser une nouvelle tenue</Text>
              </TouchableOpacity>
            </View>

          </Animated.View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: BG },
  scroll: { padding: 20, paddingBottom: 48 },

  // Titres
  beforeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  bellIcon:     { position: 'absolute', right: 0 },
  title:    { fontSize: 22, fontWeight: '800', color: TEXT_PRI, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, color: TEXT_SEC, textAlign: 'center', lineHeight: 19, marginBottom: 20, paddingHorizontal: 12 },
  titleLeft:    { fontSize: 21, fontWeight: '800', color: TEXT_PRI, marginBottom: 3 },
  subtitleLeft: { fontSize: 12, color: TEXT_SEC, lineHeight: 17 },

  // Carte upload
  uploadCard: {
    backgroundColor: '#FFF6F9',
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 20,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#F3CEDC',
    borderStyle: 'dashed',
  },
  uploadOption:    { alignItems: 'center', paddingVertical: 6 },
  cameraCircle: {
    width: 84, height: 84, borderRadius: 42,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
    shadowColor: ACCENT, shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  galleryCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#F4EEEA',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  uploadOptionText: { fontSize: 16, fontWeight: '700', color: TEXT_PRI },
  uploadOptionSub:  { fontSize: 12, color: TEXT_SEC, marginTop: 3 },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#EFD9E2' },
  dividerText: { marginHorizontal: 14, color: TEXT_SEC, fontSize: 13 },

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
  creditsChip:        { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: ACCENT + '60' },
  creditsChipEmpty:   { borderColor: BORDER },
  creditsChipText:    { fontSize: 12, fontWeight: '700', color: ACCENT },
  creditsChipTextEmpty: { color: TEXT_SEC },

  // Plus de crédits
  noCreditsCard:  { backgroundColor: CARD, borderRadius: 16, padding: 18, marginBottom: 14, alignItems: 'center', gap: 8 },
  noCreditsTitle: { fontWeight: '800', fontSize: 15, color: TEXT_PRI },
  noCreditsText:  { fontSize: 13, lineHeight: 18, textAlign: 'center', color: TEXT_SEC },
  noCreditsBtn:   { backgroundColor: ACCENT, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  noCreditsBtnText: { color: BTN_TEXT, fontWeight: '700', fontSize: 13 },

  // Bouton analyser
  analyzeBtn: {
    backgroundColor: ACCENT,
    borderRadius: 16, padding: 16,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    shadowColor: ACCENT,
    shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  analyzeBtnDisabled: { opacity: 0.75 },
  analyzeBtnInner:    { flexDirection: 'row', alignItems: 'center' },
  analyzeBtnText:     { color: BTN_TEXT, fontWeight: '700', fontSize: 16 },

  // Carte conseil
  tipCard: {
    backgroundColor: TIP_BG,
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
  tipTitle: { fontWeight: '800', fontSize: 14, color: ACCENT, marginBottom: 3 },
  tipHeart: { fontSize: 12 },
  tipBody:  { fontSize: 12.5, lineHeight: 17, color: '#8A7B74' },

  // Comment ça marche
  howTitle: { fontSize: 17, fontWeight: '800', color: TEXT_PRI, marginBottom: 14, textAlign: 'center' },
  howRow:   { flexDirection: 'row', gap: 10 },
  howCard:  {
    flex: 1, backgroundColor: CARD, borderRadius: 18, padding: 14, alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  howIconCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: TIP_BG,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  howCardTitle: { fontSize: 12, fontWeight: '800', color: TEXT_PRI, marginBottom: 6, textAlign: 'center' },
  howText:  { fontSize: 10.5, lineHeight: 14, textAlign: 'center', color: TEXT_SEC },

  // APRÈS — en-tête
  afterHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  afterHeaderLeft: { flex: 1, paddingRight: 12 },
  searchBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: CARD, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
    elevation: 2, marginTop: 2,
  },

  // Photo analysée (état résultat)
  resultPhoto: { width: '100%', height: 300, borderRadius: 18, marginBottom: 16, backgroundColor: '#EFE3DD' },

  // Cartes critères
  criterionRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  criterionCard: {
    flex: 1, backgroundColor: CARD, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 8,
    alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  criterionName:  { fontSize: 12, fontWeight: '700', color: TEXT_PRI, marginBottom: 8 },
  criterionLabel: { fontSize: 11, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  criterionDesc:  { fontSize: 9.5, color: TEXT_SEC, marginTop: 3, textAlign: 'center', lineHeight: 12.5 },

  // Note globale
  globalCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: CARD, borderRadius: 18, padding: 16, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  globalLeft:      { alignItems: 'flex-start', paddingRight: 14 },
  globalCardTitle: { fontSize: 12, color: TEXT_SEC, marginBottom: 2, fontWeight: '600' },
  globalScoreRow:  { flexDirection: 'row', alignItems: 'flex-end' },
  globalScore:     { fontSize: 38, fontWeight: '800', color: ACCENT, lineHeight: 42 },
  globalSub:       { fontSize: 13, color: TEXT_SEC, marginBottom: 6 },
  globalDivider:   { width: 1, alignSelf: 'stretch', backgroundColor: BORDER, marginVertical: 2 },
  globalRight:     { flex: 1, paddingLeft: 14, paddingRight: 8 },
  globalMessage:   { fontSize: 14, fontWeight: '800', color: TEXT_PRI, marginBottom: 2 },
  globalMessageSub:{ fontSize: 11.5, color: TEXT_SEC, lineHeight: 15 },
  globalStarBadge: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: ACCENT,
    alignItems: 'center', justifyContent: 'center',
  },

  // Conseil
  conseilCard: {
    backgroundColor: CONSEIL_BG, borderRadius: 18, padding: 16,
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16,
  },
  conseilEmoji:  { fontSize: 34 },
  conseilTexts:  { flex: 1 },
  conseilTitle:  { fontSize: 13.5, fontWeight: '800', color: TEXT_PRI, marginBottom: 4 },
  conseilBody:   { fontSize: 12.5, lineHeight: 18, color: '#7C6F69' },

  // Top OOTDs
  topSection: { marginBottom: 16 },
  topHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  topTitle:   { fontSize: 15, fontWeight: '800', color: TEXT_PRI },
  topSeeAll:  { fontSize: 12, fontWeight: '700', color: ACCENT },
  topItem:    { marginRight: 10, position: 'relative' },
  topImg:     { width: 86, height: 112, borderRadius: 14 },
  topHeartChip: {
    position: 'absolute', bottom: 6, left: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2.5,
  },
  topHeartText: { fontSize: 10, fontWeight: '800', color: TEXT_PRI },

  // Actions
  actionsCard: {
    backgroundColor: CARD, borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  captionInput: {
    backgroundColor: BG, borderRadius: 12, padding: 14, fontSize: 14,
    marginBottom: 12, borderWidth: 1, borderColor: BORDER,
    minHeight: 72, textAlignVertical: 'top', color: TEXT_PRI,
  },
  actionPrimary: {
    backgroundColor: ACCENT, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  actionPrimaryText: { color: BTN_TEXT, fontWeight: '800', fontSize: 14 },
  actionSecondary: {
    borderWidth: 1.5, borderColor: ACCENT, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    backgroundColor: CARD,
  },
  actionSecondaryText: { color: ACCENT, fontWeight: '700', fontSize: 14 },
  actionDisabled: { opacity: 0.55 },
  retryBtn:  { alignItems: 'center', paddingVertical: 10 },
  retryText: { fontSize: 13, fontWeight: '600', color: TEXT_SEC },
});
