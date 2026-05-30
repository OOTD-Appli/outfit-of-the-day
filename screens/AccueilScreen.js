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
import * as ImagePicker from 'expo-image-picker';
import Button from '../components/Button';
import Avatar from '../components/Avatar';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';

const REQUEST_TIMEOUT_MS = 25000;

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

export default function AccueilScreen({ navigation }) {
  const { width: ww, height: wh } = useWindowDimensions();
  const ringSize = Math.min(Math.round(ww * 0.22), 96);
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
  const { showToast } = useToast();
  const { theme } = useTheme();
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
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(resultRise, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(barsProgress, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();
  }, [score, barsProgress, resultFade, resultRise]);

  const fetchCredits = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('daily_credits, credits_reset_date, has_analysis_pass, has_ootd_plus_pass')
      .eq('id', user.id)
      .single();
    if (data) {
      const today = new Date().toISOString().split('T')[0];
      const hasPass = !!(data.has_analysis_pass || data.has_ootd_plus_pass);
      const max = hasPass ? 20 : 2;
      setMaxCredits(max);
      const effective = data.credits_reset_date < today ? max : data.daily_credits;
      setCredits(effective);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    fetchCredits();
  }, [fetchCredits]));

  const pickImageFromLibrary = async () => {
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
      setScore(null);
      cachedPublicUrlRef.current = null;
      setPublishedToFeed(false);
      setSentFlammesToAll(false);
      setImage(result.assets[0]);
    }
  };

  const takePicture = async () => {
    if (Platform.OS === 'web') {
      await pickImageFromLibrary();
      return;
    }
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
      setScore(null);
      cachedPublicUrlRef.current = null;
      setPublishedToFeed(false);
      setSentFlammesToAll(false);
      setImage(result.assets[0]);
    }
  };

  const openImageSourcePicker = () => {
    if (Platform.OS === 'web') {
      pickImageFromLibrary();
      return;
    }
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
      if (typeof parsed.credits_remaining === "number") setCredits(parsed.credits_remaining);
      if (typeof parsed.max_credits === "number") setMaxCredits(parsed.max_credits);
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

  const scoreTone = (value) => {
    if (value >= 8) return '#3ED598';
    if (value >= 6) return '#F5B700';
    return '#FF6B6B';
  };

  const scoreLabel = (value) => {
    if (value >= 8) return 'Excellent look';
    if (value >= 6) return 'Très bon potentiel';
    return 'À améliorer';
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.scroll}>

        <View style={styles.header}>
          <Image source={require("../assets/logo.jpg")} style={styles.logoSmall} />
          <View style={[styles.creditsChip, { backgroundColor: theme.card, borderColor: credits === 0 ? theme.border : theme.accent + '55' }]}>
            <Text style={[styles.creditsChipText, { color: credits === 0 ? theme.textSub : theme.accent }]}>
              {credits === null ? "⚡ ..." : `⚡ ${credits}/${maxCredits}`}
            </Text>
          </View>
        </View>

        <Text style={[styles.pageTitle, { color: theme.textPri }]}>Ton analyse style</Text>
        <Text style={[styles.pageSubtitle, { color: theme.textSub }]}>
          Analyse ta tenue, puis choisis : publier dans le feed et/ou l'envoyer à tes amis pour les flammes (1 snap / jour / ami).
        </Text>

        <TouchableOpacity style={styles.photoZone} onPress={openImageSourcePicker}>
          {image ? (
            <Image source={{ uri: image.uri }} style={styles.photo} />
          ) : (
            <View style={[styles.photoPlaceholder, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={styles.photoIcon}>👗</Text>
              <Text style={[styles.photoHint, { color: theme.textSub }]}>Appuie pour choisir ta tenue</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.sourceActions}>
          <Button title="📸 Prendre une photo" variant="primary" onPress={takePicture} style={{ flex: 1 }} />
          <Button title="🖼️ Galerie" variant="secondary" onPress={pickImageFromLibrary} style={{ flex: 1 }} />
        </View>

        {credits === 0 && (
          <View style={[styles.noCreditsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Text style={[styles.noCreditsTitle, { color: theme.textPri }]}>⚡ Analyses épuisées pour aujourd'hui</Text>
            <Text style={[styles.noCreditsText, { color: theme.textSub }]}>
              Tu as utilisé tes 2 analyses quotidiennes. Reviens demain pour continuer !
            </Text>
            <TouchableOpacity style={[styles.noCreditsCta, { backgroundColor: theme.accent }]} activeOpacity={0.8} onPress={() => navigation.navigate('Shop')}>
              <Text style={styles.noCreditsCtaText}>🌟 Obtenir plus de crédits</Text>
            </TouchableOpacity>
          </View>
        )}

        {image && !score && credits !== 0 && (
          <TouchableOpacity
            style={[styles.analyzeBtn, (loading || credits === null) && styles.analyzeBtnDisabled, { backgroundColor: theme.accent, shadowColor: theme.accent }]}
            onPress={analyzeOutfit}
            disabled={loading || credits === null}
          >
            {loading
              ? <Text style={styles.analyzeBtnText}>Analyse en cours...</Text>
              : <Text style={styles.analyzeBtnText}>✨ Lancer l'analyse</Text>
            }
          </TouchableOpacity>
        )}

        {loading && (
          <View style={[styles.loadingCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <ActivityIndicator color={theme.accent} />
            <Text style={[styles.loadingText, { color: theme.textSub }]}>On étudie ta tenue, 2-3 secondes...</Text>
          </View>
        )}

        {score && (
          <Animated.View
            style={[
              styles.scoreCard,
              { opacity: resultFade, transform: [{ translateY: resultRise }], backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <View style={[styles.scoreRing, { borderColor: scoreTone(score.global), width: ringSize, height: ringSize, borderRadius: ringSize / 2 }]}>
              <Text style={[styles.scoreNum, { color: scoreTone(score.global), fontSize: Math.round(ringSize * 0.32) }]}>{score.global}</Text>
              <Text style={[styles.scoreSub, { color: theme.textSub }]}>/ 10</Text>
            </View>
            <Text style={[styles.scoreLabel, { color: theme.textPri }]}>{scoreLabel(score.global)}</Text>
            <Text style={[styles.scoreSummary, { color: theme.textSub }]}>
              Résultat global de ta tenue aujourd'hui.
            </Text>

            {[
              { key: 'fit', label: 'Fit', val: score.fit },
              { key: 'harmonie', label: 'Harmonie', val: score.harmonie },
              { key: 'detail', label: 'Détail', val: score.detail },
            ].map(item => (
              <View key={item.label} style={styles.barRow}>
                <View style={styles.barLabels}>
                  <Text style={[styles.barName, { color: theme.textSub }]}>{item.label}</Text>
                  <Text style={[styles.barVal, { color: scoreTone(item.val) }]}>{item.val}/10</Text>
                </View>
                <View style={[styles.barBg, { backgroundColor: theme.border }]}>
                  <Animated.View
                    style={[
                      styles.barFill,
                      {
                        width: barsProgress.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0%', `${item.val * 10}%`],
                        }),
                        backgroundColor: scoreTone(item.val),
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.criterionReason, { color: theme.textSub }]}>
                  {score?.explications?.[item.key]}
                </Text>
              </View>
            ))}

            <Text style={[styles.conseilTitle, { color: theme.accent }]}>Conseil personnalisé</Text>
            <Text style={[styles.conseil, { color: theme.textPri }]}>{score.conseil}</Text>

            <Text style={[styles.shareHint, { color: theme.textSub }]}>
              Rien n'est public tant que tu n'as pas publié. Tu peux faire les deux actions ou une seule.
            </Text>

            <TextInput
              style={[styles.captionInput, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
              placeholder="Ajoute une description à ta tenue..."
              placeholderTextColor={theme.textSub}
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={200}
            />

            <TouchableOpacity
              style={[
                styles.actionPrimary,
                (publishedToFeed || postingFeed) && styles.actionDisabled,
                { backgroundColor: theme.accent },
              ]}
              onPress={publishToFeed}
              disabled={publishedToFeed || postingFeed}
            >
              {postingFeed ? (
                <ActivityIndicator color="#3a0d1e" />
              ) : (
                <Text style={styles.actionPrimaryText}>
                  {publishedToFeed ? '✓ Publié dans le feed' : '🏠 Publier dans le feed'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionSecondary,
                (sentFlammesToAll || sendingFlammesAll) && styles.actionDisabled,
                { borderColor: theme.accent, backgroundColor: theme.card },
              ]}
              onPress={sendOutfitToAllFlammes}
              disabled={sentFlammesToAll || sendingFlammesAll}
            >
              {sendingFlammesAll ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Text style={[styles.actionSecondaryText, { color: theme.accent }]}>
                  {sentFlammesToAll
                    ? '✓ Envoyé à tes flammes'
                    : '🔥 Envoyer à tous mes amis (flames)'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.retryBtn, { borderColor: theme.border, backgroundColor: theme.card }]}
              onPress={() => {
                setImage(null);
                setScore(null);
                cachedPublicUrlRef.current = null;
                setPublishedToFeed(false);
                setSentFlammesToAll(false);
              }}
            >
              <Text style={[styles.retryText, { color: theme.textSub }]}>Analyser une nouvelle tenue</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  scroll:       { padding: 20, paddingBottom: 40 },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  pageTitle:    { fontSize: 28, fontWeight: '800', marginBottom: 6 },
  pageSubtitle: { fontSize: 13, lineHeight: 19, marginBottom: 18 },
  creditsChip:      { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1 },
  creditsChipText:  { fontSize: 12, fontWeight: '700' },

  noCreditsCard:    { borderRadius: 16, padding: 18, alignItems: 'center', borderWidth: 1, marginBottom: 16, gap: 8 },
  noCreditsTitle:   { fontWeight: '800', fontSize: 15 },
  noCreditsText:    { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  noCreditsCta:     { borderRadius: 12, paddingHorizontal: 20, paddingVertical: 10, marginTop: 4 },
  noCreditsCtaText: { color: '#3a0d1e', fontWeight: '700', fontSize: 13 },

  photoZone:        { width: '100%', aspectRatio: 3 / 4, borderRadius: 20, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: '#E0E0E0' },
  photo:            { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, borderWidth: 1, borderStyle: 'dashed', borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 10 },
  photoIcon:        { fontSize: 52 },
  photoHint:        { fontSize: 14 },
  sourceActions:    { flexDirection: 'row', gap: 10, marginBottom: 16 },

  analyzeBtn:         { borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 16, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  analyzeBtnDisabled: { opacity: 0.75 },
  analyzeBtnText:     { color: '#3a0d1e', fontWeight: '700', fontSize: 16 },
  loadingCard:        { borderRadius: 16, borderWidth: 1, padding: 14, flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 18 },
  loadingText:        { fontSize: 12 },

  scoreCard:    { borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1 },
  scoreRing:    { width: 80, height: 80, borderRadius: 40, borderWidth: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  scoreNum:     { fontSize: 26, fontWeight: '700' },
  scoreSub:     { fontSize: 11 },
  scoreLabel:   { fontWeight: '700', fontSize: 16, marginBottom: 4 },
  scoreSummary: { fontSize: 12, marginBottom: 16 },

  barRow:    { width: '100%', marginBottom: 10 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barName:   { fontSize: 12 },
  barVal:    { fontSize: 12, fontWeight: '700' },
  barBg:     { height: 7, borderRadius: 4, overflow: 'hidden' },
  barFill:   { height: '100%', borderRadius: 3 },
  criterionReason: { fontSize: 12, lineHeight: 18, marginTop: 7 },

  conseilTitle: { fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  conseil:      { fontSize: 13, lineHeight: 20, textAlign: 'left', marginBottom: 12, width: '100%' },
  shareHint:    { fontSize: 11, lineHeight: 16, marginBottom: 14, textAlign: 'center', width: '100%' },
  actionPrimary: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  actionPrimaryText: { color: '#3a0d1e', fontWeight: '800', fontSize: 14 },
  actionSecondary: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  actionSecondaryText: { fontWeight: '700', fontSize: 14 },
  actionDisabled: { opacity: 0.55 },
  retryBtn:  { borderWidth: 1, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 11 },
  retryText: { fontSize: 13, fontWeight: '600' },
  logoSmall: { width: 40, height: 40, borderRadius: 8 },
  captionInput: {
    width: '100%',
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    marginBottom: 14,
    borderWidth: 1,
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
