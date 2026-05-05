import { supabase } from '../lib/supabase';
import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Image, ScrollView, SafeAreaView, ActivityIndicator
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export default function AccueilScreen() {
  const [image, setImage] = useState(null);
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      alert('Permission refusée pour accéder à la galerie');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      base64: true,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled) {
      setImage(result.assets[0]);
      setScore(null);
    }
  };

  const analyzeOutfit = async () => {
    if (!image) return;
    setLoading(true);
    try {
      const base64Image = `data:image/jpeg;base64,${image.base64}`;

      // 1. Analyse IA
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer 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',
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: base64Image } },
              {
                type: 'text',
                text: `Tu es un critique de mode honnête et constructive. Analyse cette tenue en détail et attribue des notes VARIÉES et RÉALISTES selon ce que tu vois vraiment.

Règles strictes :
- Sois critique et précis, pas complaisant
- Les notes doivent refléter la vraie tenue (une tenue basique ne mérite pas 9/10)
- Varie les notes entre les critères selon ce que tu observes réellement
- Le conseil doit être spécifique à cette tenue, pas générique

Réponds UNIQUEMENT en JSON valide sans markdown, avec ce format exact :
{"global": 6, "couleurs": 7, "coupe": 5, "tendance": 6, "conseil": "conseil spécifique ici"}`
              }
            ]
          }]
        })
      });

      const data = await response.json();
      const text = data.choices[0].message.content;
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);

      // 2. Upload photo dans Supabase Storage
      const { data: { user } } = await supabase.auth.getUser();
      const fileName = `${user.id}/${Date.now()}.jpg`;
      const photoResponse = await fetch(image.uri);
      const blob = await photoResponse.blob();

      const { error: uploadError } = await supabase.storage
        .from('ootds')
        .upload(fileName, blob, { contentType: 'image/jpeg' });

      if (uploadError) {
        console.log('Upload error:', uploadError.message);
      } else {
        // 3. Récupère l'URL publique
        const { data: urlData } = supabase.storage
          .from('ootds')
          .getPublicUrl(fileName);

        // 4. Sauvegarde dans la base de données
        // 4. Sauvegarde dans la base de données
        await supabase.from('ootds').insert({
          user_id: user.id,
          image_url: urlData.publicUrl,
          score_global: parsed.global,
          score_couleurs: parsed.couleurs,
          score_coupe: parsed.coupe,
          score_tendance: parsed.tendance,
          conseil: parsed.conseil,
        });

        // 5. Ajoute des points au profil
        const pointsGagnes = Math.round(parsed.global * 10);
        const { data: profil } = await supabase
          .from('profiles')
          .select('points, niveau')
          .eq('id', user.id)
          .single();

        const newPoints = (profil.points || 0) + pointsGagnes;
        const newNiveau = Math.floor(newPoints / 100) + 1;

        await supabase.from('profiles').update({
          points: newPoints,
          niveau: newNiveau,
        }).eq('id', user.id);

        alert(`+${pointsGagnes} points gagnés ! 🎉`);
      }

      setScore(parsed);
    } catch (e) {
      alert('Erreur : ' + e.message);
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        <View style={styles.header}>
        <Image source={require('../assets/logo.png')} style={styles.logoSmall} />
        <View style={styles.pill}><Text style={styles.pillText}>Auj. 14h</Text></View>
        </View>

        <TouchableOpacity style={styles.photoZone} onPress={pickImage}>
          {image ? (
            <Image source={{ uri: image.uri }} style={styles.photo} />
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoIcon}>👗</Text>
              <Text style={styles.photoHint}>Appuie pour choisir ta tenue</Text>
            </View>
          )}
        </TouchableOpacity>

        {image && !score && (
          <TouchableOpacity
            style={styles.analyzeBtn}
            onPress={analyzeOutfit}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.analyzeBtnText}>✨ Analyser ma tenue</Text>
            }
          </TouchableOpacity>
        )}

        {score && (
          <View style={styles.scoreCard}>
            <View style={styles.scoreRing}>
              <Text style={styles.scoreNum}>{score.global}</Text>
              <Text style={styles.scoreSub}>/ 10</Text>
            </View>
            <Text style={styles.scoreLabel}>Outfit stylé !</Text>

            {[
              { label: 'Couleurs', val: score.couleurs },
              { label: 'Coupe',    val: score.coupe },
              { label: 'Tendance', val: score.tendance },
            ].map(item => (
              <View key={item.label} style={styles.barRow}>
                <View style={styles.barLabels}>
                  <Text style={styles.barName}>{item.label}</Text>
                  <Text style={styles.barVal}>{item.val}</Text>
                </View>
                <View style={styles.barBg}>
                  <View style={[styles.barFill, { width: `${item.val * 10}%` }]} />
                </View>
              </View>
            ))}

            <Text style={styles.conseil}>{score.conseil}</Text>

            <TouchableOpacity style={styles.retryBtn} onPress={() => { setImage(null); setScore(null); }}>
              <Text style={styles.retryText}>Nouvelle tenue</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0a0a0a' },
  scroll:      { padding: 20, paddingBottom: 40 },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title:       { fontSize: 24, fontWeight: '700', color: '#fff' },
  pill:        { backgroundColor: '#3a0d1e', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  pillText:    { color: '#ED93B1', fontSize: 12, fontWeight: '600' },

  photoZone:        { width: '100%', height: 280, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  photo:            { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#333', borderStyle: 'dashed', borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 10 },
  photoIcon:        { fontSize: 52 },
  photoHint:        { color: '#666', fontSize: 14 },

  analyzeBtn:     { backgroundColor: '#ED93B1', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 20 },
  analyzeBtnText: { color: '#3a0d1e', fontWeight: '700', fontSize: 16 },

  scoreCard:  { backgroundColor: '#0f0f0f', borderRadius: 16, padding: 20, alignItems: 'center' },
  scoreRing:  { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#ED93B1', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  scoreNum:   { fontSize: 26, fontWeight: '700', color: '#ED93B1' },
  scoreSub:   { fontSize: 11, color: '#888' },
  scoreLabel: { color: '#ED93B1', fontWeight: '600', fontSize: 15, marginBottom: 16 },

  barRow:    { width: '100%', marginBottom: 10 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barName:   { color: '#888', fontSize: 12 },
  barVal:    { color: '#AFA9EC', fontSize: 12, fontWeight: '600' },
  barBg:     { height: 6, backgroundColor: '#1a1a1a', borderRadius: 3, overflow: 'hidden' },
  barFill:   { height: '100%', backgroundColor: '#AFA9EC', borderRadius: 3 },

  conseil:  { color: '#888', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 12, marginBottom: 16 },
  retryBtn: { borderWidth: 1, borderColor: '#333', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  retryText:{ color: '#666', fontSize: 13 },
  logoSmall: { width: 40, height: 40, borderRadius: 8 },
});