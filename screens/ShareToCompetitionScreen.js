import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Switch,
  ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/themeContext';
import { useToast } from '../lib/toastContext';
import { getPendingOutfit, clearPendingOutfit } from '../lib/pendingOutfit';

// Étape "Partager à quelle(s) compétition(s) ?" après l'analyse : multi-select
// + toggle "Rendre publique (Feed)", indépendants l'un de l'autre (hypothèse 1
// du cahier des charges Compétitions v2, confirmée). Remplace les 3 boutons
// mutuellement exclusifs (publier/flammes/enregistrer) de l'ancien flow.
export default function ShareToCompetitionScreen({ navigation }) {
  const { theme } = useTheme();
  const { showToast } = useToast();
  const outfit = getPendingOutfit();

  const [competitions, setCompetitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [makePublic, setMakePublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadCompetitions = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('competition_members')
        .select('competitions(id, name)')
        .eq('user_id', user.id)
        .order('competitions(created_at)', { ascending: false });
      if (error) throw error;
      setCompetitions((data || []).map(r => r.competitions).filter(Boolean));
    } catch (e) {
      showToast(e?.message || 'Erreur chargement compétitions', { type: 'error' });
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { loadCompetitions(); }, [loadCompetitions]);

  if (!outfit) {
    // Écran atteint sans tenue en attente (retour arrière après coup, etc.)
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: theme.textSub }}>Aucune tenue en attente.</Text>
        <TouchableOpacity style={{ marginTop: 16 }} onPress={() => navigation.goBack()}>
          <Text style={{ color: theme.accent, fontWeight: '700' }}>Retour</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const toggleCompetition = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('submit_ootd_to_competitions', {
        p_image_url: outfit.imageUrl,
        p_score_global: outfit.score.global,
        p_couleurs_note: outfit.score.harmonie,
        p_coupe_note: outfit.score.fit,
        p_style_note: outfit.score.detail,
        p_conseil: outfit.score.conseil ?? null,
        p_caption: outfit.caption || null,
        p_styles: outfit.score.styles || [],
        p_show_style_hashtag: outfit.showStyleHashtag ?? true,
        p_visible_scores: outfit.visibleScores || [],
        p_audio_title: outfit.music?.title || null,
        p_audio_artist: outfit.music?.artist || null,
        p_audio_preview_url: outfit.music?.previewUrl || null,
        p_audio_cover_url: outfit.music?.coverUrl || null,
        p_competition_ids: Array.from(selected),
        p_make_public: makePublic,
      });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.error || 'Erreur inconnue');

      clearPendingOutfit();
      const parts = [];
      if (makePublic) parts.push('publiée dans le feed');
      if (selected.size > 0) parts.push(`partagée à ${selected.size} compétition${selected.size > 1 ? 's' : ''}`);
      const msg = parts.length ? `Tenue ${parts.join(' et ')}. +${data.points_earned} points.` : `Enregistrée dans ta galerie. +${data.points_earned} points.`;
      showToast(msg, { type: 'success' });

      if (selected.size === 1) {
        const comp = competitions.find(c => c.id === Array.from(selected)[0]);
        navigation.replace('Competition', { competitionId: comp.id, competitionName: comp.name });
      } else if (makePublic) {
        navigation.navigate('Feed');
      } else {
        navigation.navigate('AccueilHome');
      }
    } catch (e) {
      showToast(e?.message || 'Erreur inconnue', { type: 'error' });
    }
    setSubmitting(false);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} disabled={submitting}>
          <Ionicons name="chevron-back" size={24} color={theme.textPri} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPri }]}>Partager ta tenue</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={competitions}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Image source={{ uri: outfit.imageUrl }} style={styles.preview} />

            <View style={[styles.publicRow, { borderColor: theme.border, backgroundColor: theme.card }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.publicTitle, { color: theme.textPri }]}>Rendre publique</Text>
                <Text style={[styles.publicSub, { color: theme.textSub }]}>Apparaît aussi dans le Feed</Text>
              </View>
              <Switch
                value={makePublic}
                onValueChange={setMakePublic}
                trackColor={{ false: '#555', true: theme.accent + '88' }}
                thumbColor={makePublic ? theme.accent : '#888'}
              />
            </View>

            <Text style={[styles.sectionLabel, { color: theme.textSub }]}>Partager à une compétition</Text>
            {loading && <ActivityIndicator color={theme.accent} style={{ marginVertical: 12 }} />}
            {!loading && competitions.length === 0 && (
              <Text style={{ color: theme.textSub, fontSize: 13, marginBottom: 8 }}>
                Tu n'as pas encore de compétition. Tu peux quand même enregistrer cette tenue.
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const isSelected = selected.has(item.id);
          return (
            <TouchableOpacity
              style={[styles.compRow, { borderColor: theme.border, backgroundColor: theme.card }]}
              onPress={() => toggleCompetition(item.id)}
              activeOpacity={0.85}
            >
              <View style={[styles.checkbox, { borderColor: theme.accent }, isSelected && { backgroundColor: theme.accent }]}>
                {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={[styles.compName, { color: theme.textPri }]}>{item.name}</Text>
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.list}
      />

      <View style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.bg }]}>
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: theme.accent }, submitting && styles.disabled]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator color="#fff" /> : (
            <Text style={styles.submitText}>
              {selected.size > 0 || makePublic ? 'Publier' : 'Enregistrer pour moi'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 16, fontWeight: '800' },
  list: { padding: 18, paddingBottom: 100 },
  listHeader: { marginBottom: 8 },
  preview: { width: '100%', height: 220, borderRadius: 16, marginBottom: 16, backgroundColor: '#0001' },
  publicRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 20, gap: 10 },
  publicTitle: { fontWeight: '700', fontSize: 14.5 },
  publicSub: { fontSize: 12, marginTop: 2 },
  sectionLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  compRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  compName: { fontWeight: '600', fontSize: 14.5 },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  submitBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.6 },
});
