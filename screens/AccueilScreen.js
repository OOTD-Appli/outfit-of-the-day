import { supabase } from '../lib/supabase';
import { ENV, requireEnv } from '../lib/env';
import { useEffect, useRef, useState } from 'react';
import { decode } from 'base64-arraybuffer';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ScrollView, SafeAreaView, ActivityIndicator, Alert, Animated, Easing
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

const REQUEST_TIMEOUT_MS = 25000;
const CRITERIA_KEYS = ['fit', 'harmonie', 'detail'];

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]);
}

export default function AccueilScreen() {
  const [image, setImage] = useState(null);
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(false);
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

  const pickImageFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      alert('Permission refusée pour accéder à la galerie');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
      allowsEditing: false,
    });
    if (!result.canceled) {
      setImage(result.assets[0]);
      setScore(null);
    }
  };

  const takePicture = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      alert('Permission refusée pour accéder à la caméra');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      base64: true,
      allowsEditing: false,
      cameraType: ImagePicker.CameraType.back,
    });
    if (!result.canceled) {
      setImage(result.assets[0]);
      setScore(null);
    }
  };

  const openImageSourcePicker = () => {
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
    if (!image) return;
    setLoading(true);
    try {
      if (!image.base64) {
        throw new Error('Impossible de lire la photo. Réessaie en choisissant une autre image.');
      }

      const base64Image = `data:image/jpeg;base64,${image.base64}`;

      const groqApiKey = requireEnv('EXPO_PUBLIC_GROQ_API_KEY', ENV.groqApiKey);

      // 1. Analyse IA
      const response = await withTimeout(fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 500,
          temperature: 0.8,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: base64Image } },
              {
                type: 'text',
                text: `Tu es un styliste-conseiller expert. Analyse uniquement ce qui est VISIBLE sur la photo.

Barème (notes entières de 1 à 10):
- global: impression générale de la tenue
- fit: précision de la coupe sur le corps, proportion, tombé
- harmonie: équilibre des couleurs, matières et textures
- detail: soin des finitions et accessoires visibles

Contraintes:
- Les notes doivent être variées et réalistes (évite les mêmes notes partout)
- N'utilise 9-10 que pour une tenue vraiment remarquable
- Le conseil doit être ultra concret, actionnable, et lié à cette photo
- N'invente pas des éléments non visibles
- Si un élément est peu visible, donne une note prudente (4 à 6), pas extrême
- Explique brièvement pourquoi chaque note a été donnée (1 phrase par critère)
- Le conseil doit être structuré en 2 parties: "Ce qui marche" puis "À essayer"

Réponds UNIQUEMENT en JSON valide (sans markdown) au format exact:
{"global": 6, "fit": 7, "harmonie": 6, "detail": 6, "explications": {"fit": "explication", "harmonie": "explication", "detail": "explication"}, "conseil": "Ce qui marche: ... À essayer: ..."}`
              }
            ]
          }]
        })
      }), REQUEST_TIMEOUT_MS, 'L’analyse est trop longue. Vérifie ta connexion et réessaie.');

      if (!response.ok) {
        throw new Error(`Analyse indisponible (${response.status}).`);
      }

      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('Réponse IA invalide.');
      }
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      if (typeof parsed.global !== 'number') {
        throw new Error('Analyse IA incomplète, réessaie.');
      }
      const hasAllCriteria = CRITERIA_KEYS.every((key) => typeof parsed[key] === 'number');
      if (!hasAllCriteria) {
        throw new Error('Analyse IA invalide, réessaie.');
      }
      const hasExplications = CRITERIA_KEYS.every((key) => typeof parsed?.explications?.[key] === 'string');
      if (!hasExplications) {
        throw new Error('Analyse IA incomplète (explications manquantes), réessaie.');
      }
      if (typeof parsed.conseil !== 'string' || parsed.conseil.trim().length < 40) {
        throw new Error('Conseil IA trop court, réessaie.');
      }

      // 2. Upload photo dans Supabase Storage
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('Session expirée. Reconnecte-toi.');
      }
      const fileName = `${user.id}/${Date.now()}.jpg`;
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

      // 3. Récupère l'URL publique
      const { data: urlData } = supabase.storage
        .from('ootds')
        .getPublicUrl(fileName);

      // 4. Sauvegarde dans la base de données
      const { error: insertError } = await supabase.from('ootds').insert({
        user_id: user.id,
        image_url: urlData.publicUrl,
        score_global: parsed.global,
        score_couleurs: parsed.harmonie,
        score_coupe: parsed.fit,
        score_tendance: parsed.detail,
        conseil: parsed.conseil,
      });
      if (insertError) {
        throw new Error(`Sauvegarde impossible: ${insertError.message}`);
      }

      // 5. Ajoute des points au profil
      const pointsGagnes = Math.round(parsed.global * 10);
      const { data: profil, error: profileError } = await supabase
        .from('profiles')
        .select('points, niveau')
        .eq('id', user.id)
        .single();
      if (profileError) {
        throw new Error(`Lecture du profil impossible: ${profileError.message}`);
      }

      const newPoints = (profil.points || 0) + pointsGagnes;
      const newNiveau = Math.floor(newPoints / 100) + 1;

      const { error: updateProfileError } = await supabase.from('profiles').update({
        points: newPoints,
        niveau: newNiveau,
      }).eq('id', user.id);
      if (updateProfileError) {
        throw new Error(`Mise à jour profil impossible: ${updateProfileError.message}`);
      }

      alert(`+${pointsGagnes} points gagnés ! 🎉`);
      setScore(parsed);
    } catch (e) {
      alert(e.message || 'Une erreur est survenue pendant l’analyse.');
      console.log('analyzeOutfit error:', e);
    }
    setLoading(false);
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
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        <View style={styles.header}>
          <Image source={require('../assets/logo.png')} style={styles.logoSmall} />
          <View style={styles.pill}><Text style={styles.pillText}>OOTD du jour</Text></View>
        </View>

        <Text style={styles.pageTitle}>Ton analyse style</Text>
        <Text style={styles.pageSubtitle}>
          Poste une photo et reçois un score détaillé + un conseil concret.
        </Text>

        <TouchableOpacity style={styles.photoZone} onPress={openImageSourcePicker}>
          {image ? (
            <Image source={{ uri: image.uri }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoIcon}>👗</Text>
              <Text style={styles.photoHint}>Appuie pour choisir ta tenue</Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.sourceActions}>
          <TouchableOpacity style={styles.sourcePrimaryBtn} onPress={takePicture}>
            <Text style={styles.sourcePrimaryText}>📸 Prendre une photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.sourceSecondaryBtn} onPress={pickImageFromLibrary}>
            <Text style={styles.sourceSecondaryText}>🖼️ Galerie</Text>
          </TouchableOpacity>
        </View>

        {image && !score && (
          <TouchableOpacity
            style={[styles.analyzeBtn, loading && styles.analyzeBtnDisabled]}
            onPress={analyzeOutfit}
            disabled={loading}
          >
            {loading
              ? <Text style={styles.analyzeBtnText}>Analyse en cours...</Text>
              : <Text style={styles.analyzeBtnText}>✨ Lancer l'analyse</Text>
            }
          </TouchableOpacity>
        )}

        {loading && (
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#ED93B1" />
            <Text style={styles.loadingText}>On étudie ta tenue, 2-3 secondes...</Text>
          </View>
        )}

        {score && (
          <Animated.View
            style={[
              styles.scoreCard,
              { opacity: resultFade, transform: [{ translateY: resultRise }] },
            ]}
          >
            <View style={[styles.scoreRing, { borderColor: scoreTone(score.global) }]}>
              <Text style={[styles.scoreNum, { color: scoreTone(score.global) }]}>{score.global}</Text>
              <Text style={styles.scoreSub}>/ 10</Text>
            </View>
            <Text style={styles.scoreLabel}>{scoreLabel(score.global)}</Text>
            <Text style={styles.scoreSummary}>
              Résultat global de ta tenue aujourd'hui.
            </Text>

            {[
              { key: 'fit', label: 'Fit', val: score.fit },
              { key: 'harmonie', label: 'Harmonie', val: score.harmonie },
              { key: 'detail', label: 'Détail', val: score.detail },
            ].map(item => (
              <View key={item.label} style={styles.barRow}>
                <View style={styles.barLabels}>
                  <Text style={styles.barName}>{item.label}</Text>
                  <Text style={[styles.barVal, { color: scoreTone(item.val) }]}>{item.val}/10</Text>
                </View>
                <View style={styles.barBg}>
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
                <Text style={styles.criterionReason}>
                  {score?.explications?.[item.key]}
                </Text>
              </View>
            ))}

            <Text style={styles.conseilTitle}>Conseil personnalisé</Text>
            <Text style={styles.conseil}>{score.conseil}</Text>

            <TouchableOpacity style={styles.retryBtn} onPress={() => { setImage(null); setScore(null); }}>
              <Text style={styles.retryText}>Analyser une nouvelle tenue</Text>
            </TouchableOpacity>
          </Animated.View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a0a' },
  scroll:      { padding: 20, paddingBottom: 40 },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  pageTitle:   { fontSize: 28, fontWeight: '800', color: '#fff', marginBottom: 6 },
  pageSubtitle:{ color: '#8f8f95', fontSize: 13, lineHeight: 19, marginBottom: 18 },
  pill:        { backgroundColor: '#22151c', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: '#3a2630' },
  pillText:    { color: '#ED93B1', fontSize: 12, fontWeight: '600' },

  photoZone:        { width: '100%', aspectRatio: 3 / 4, borderRadius: 20, overflow: 'hidden', marginBottom: 12, borderWidth: 1, borderColor: '#1f1f23' },
  photo:            { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, backgroundColor: '#141418', borderWidth: 1, borderColor: '#2d2d33', borderStyle: 'dashed', borderRadius: 20, alignItems: 'center', justifyContent: 'center', gap: 10 },
  photoIcon:        { fontSize: 52 },
  photoHint:        { color: '#8d8d95', fontSize: 14 },
  sourceActions:    { flexDirection: 'row', gap: 10, marginBottom: 16 },
  sourcePrimaryBtn: { flex: 1, backgroundColor: '#ED93B1', borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
  sourcePrimaryText:{ color: '#3a0d1e', fontWeight: '700', fontSize: 13 },
  sourceSecondaryBtn: { paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: '#2f2f35', alignItems: 'center', justifyContent: 'center', backgroundColor: '#15151a' },
  sourceSecondaryText: { color: '#dfdfe3', fontWeight: '600', fontSize: 12 },

  analyzeBtn:     { backgroundColor: '#ED93B1', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 16, shadowColor: '#ED93B1', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  analyzeBtnDisabled: { opacity: 0.75 },
  analyzeBtnText: { color: '#3a0d1e', fontWeight: '700', fontSize: 16 },
  loadingCard:    { backgroundColor: '#121218', borderRadius: 16, borderWidth: 1, borderColor: '#24242c', padding: 14, flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 18 },
  loadingText:    { color: '#b0b0b8', fontSize: 12 },

  scoreCard:  { backgroundColor: '#121218', borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#24242c' },
  scoreRing:  { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#ED93B1', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  scoreNum:   { fontSize: 26, fontWeight: '700', color: '#ED93B1' },
  scoreSub:   { fontSize: 11, color: '#94949d' },
  scoreLabel: { color: '#fff', fontWeight: '700', fontSize: 16, marginBottom: 4 },
  scoreSummary: { color: '#8f8f95', fontSize: 12, marginBottom: 16 },

  barRow:    { width: '100%', marginBottom: 10 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barName:   { color: '#9d9da5', fontSize: 12 },
  barVal:    { fontSize: 12, fontWeight: '700' },
  barBg:     { height: 7, backgroundColor: '#1e1e24', borderRadius: 4, overflow: 'hidden' },
  barFill:   { height: '100%', backgroundColor: '#AFA9EC', borderRadius: 3 },
  criterionReason: { color: '#b5b5bd', fontSize: 12, lineHeight: 18, marginTop: 7 },

  conseilTitle: { color: '#ED93B1', fontSize: 12, fontWeight: '700', marginTop: 10, marginBottom: 6 },
  conseil:  { color: '#d0d0d0', fontSize: 13, lineHeight: 20, textAlign: 'left', marginBottom: 16, width: '100%' },
  retryBtn: { borderWidth: 1, borderColor: '#2f2f35', borderRadius: 12, paddingHorizontal: 20, paddingVertical: 11, backgroundColor: '#17171d' },
  retryText:{ color: '#e1e1e6', fontSize: 13, fontWeight: '600' },
  logoSmall: { width: 40, height: 40, borderRadius: 8 },
});