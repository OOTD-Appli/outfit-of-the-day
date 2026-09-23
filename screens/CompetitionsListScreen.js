import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/toastContext';
import { useCompetitionFonts, FONT_DISPLAY, FONT_BODY } from '../lib/competitionFonts';

// Racine de l'onglet Compétitions (décision D2, UX_DESIGN.md) — même palette
// fixe/police que CompetitionScreen (voir sa note en tête de fichier), pour
// une identité visuelle cohérente sur toute l'aire "Compétitions" plutôt que
// le useTheme() générique clair/sombre du reste de l'app.
const C = {
  bgPage: '#0B0710', bgGlow: '#2A0F1E', bgBase: '#0D0810',
  bgElevated: '#18101B', bgElevated2: '#211722',
  borderSoft: 'rgba(237,147,177,0.16)', borderSoft2: 'rgba(237,147,177,0.08)',
  accent: '#ED93B1', accentStrong: '#D45C86',
  textPri: '#F6EEF2', textSub: '#AE94A0', textFaint: '#7C6670',
  onAccent: '#3A0F22',
};

// Fetch repris à l'identique d'AccueilScreen.fetchCompetitions — NE PAS
// remplacer .order('created_at', { foreignTable: 'competitions', ... }) par
// .order('competitions(created_at)', ...) : cette syntaxe alternative a été
// un vrai bug de prod (échec silencieux du tri).
//
// Différence avec l'ancien emplacement : là-bas la section était secondaire
// dans un autre écran et les erreurs de fetch étaient avalées en silence.
// Ici, écran principal de l'onglet → une erreur est signalée via toast au
// lieu d'être avalée.
export default function CompetitionsListScreen({ navigation }) {
  const { showToast } = useToast();
  const [fontsLoaded] = useCompetitionFonts();

  const [competitions, setCompetitions] = useState([]);
  const [competitionsLoading, setCompetitionsLoading] = useState(true);

  const fetchCompetitions = useCallback(async () => {
    setCompetitionsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('competition_members')
        .select('last_read_at, competitions(id, name, created_at)')
        .eq('user_id', user.id)
        .order('created_at', { foreignTable: 'competitions', ascending: false });
      if (error) throw error;
      const rows = (data || []).filter(r => r.competitions);
      const withDetails = await Promise.all(rows.map(async (r) => {
        const [{ count: unread }, { count: memberCount }] = await Promise.all([
          supabase
            .from('competition_messages')
            .select('*', { count: 'exact', head: true })
            .eq('competition_id', r.competitions.id)
            .gt('created_at', r.last_read_at)
            .neq('sender_id', user.id),
          supabase
            .from('competition_members')
            .select('*', { count: 'exact', head: true })
            .eq('competition_id', r.competitions.id),
        ]);
        return { ...r.competitions, unread: unread || 0, memberCount: memberCount || 0 };
      }));
      setCompetitions(withDetails);
    } catch (e) {
      showToast(e?.message || 'Erreur chargement des compétitions', { type: 'error' });
    }
    setCompetitionsLoading(false);
  }, [showToast]);

  // Rafraîchi au focus (pas juste au montage) : l'onglet peut être revisité
  // après avoir créé/rejoint une compétition depuis un autre écran.
  useFocusEffect(useCallback(() => { fetchCompetitions(); }, [fetchCompetitions]));

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={[s.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={C.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <LinearGradient colors={[C.bgGlow, C.bgPage]} style={s.glow} pointerEvents="none" />

      <View style={s.header}>
        <Text style={s.headerTitle}>🏆 Compétitions</Text>
        {competitions.length > 0 && (
          <Text style={s.headerSubtitle}>{competitions.length} ligue{competitions.length > 1 ? 's' : ''} active{competitions.length > 1 ? 's' : ''}</Text>
        )}
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {competitionsLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginVertical: 24 }} />
        ) : competitions.length === 0 ? (
          <View style={s.emptyBlock}>
            <Ionicons name="trophy-outline" size={30} color={C.textFaint} />
            <Text style={s.emptyText}>Aucune compétition pour l'instant.</Text>
            <Text style={s.emptySub}>Crée-en une pour défier tes amis sur vos tenues du jour.</Text>
          </View>
        ) : (
          competitions.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={s.row}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Competition', { competitionId: c.id, competitionName: c.name })}
            >
              <View style={s.iconWrap}>
                <Ionicons name="people" size={19} color={C.accent} />
              </View>
              <View style={s.rowBody}>
                <Text style={s.rowName} numberOfLines={1}>{c.name}</Text>
                <Text style={s.rowSub}>{c.memberCount} membre{c.memberCount > 1 ? 's' : ''}</Text>
              </View>
              {c.unread > 0 && (
                <View style={s.unreadDot}>
                  <Text style={s.unreadText}>{c.unread > 9 ? '9+' : c.unread}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity
          style={s.createBtn}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('CreateCompetition')}
        >
          <Ionicons name="add" size={18} color={C.accent} />
          <Text style={s.createBtnText}>Créer une compétition</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bgPage },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 260 },

  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  headerTitle: { fontSize: 26, color: C.textPri, fontFamily: FONT_DISPLAY },
  headerSubtitle: { fontSize: 12.5, color: C.textSub, marginTop: 4, fontFamily: FONT_BODY.semibold },

  scroll: { padding: 20, paddingBottom: 48 },

  emptyBlock: { alignItems: 'center', gap: 8, paddingVertical: 36, paddingHorizontal: 20 },
  emptyText: { fontSize: 14, color: C.textSub, fontFamily: FONT_BODY.semibold, textAlign: 'center' },
  emptySub: { fontSize: 12.5, color: C.textFaint, fontFamily: FONT_BODY.regular, textAlign: 'center' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.bgElevated, borderWidth: 1, borderColor: C.borderSoft2,
    borderRadius: 18, padding: 14, marginBottom: 10,
  },
  iconWrap: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(237,147,177,0.14)', alignItems: 'center', justifyContent: 'center',
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, color: C.textPri, fontFamily: FONT_BODY.semibold },
  rowSub: { fontSize: 11.5, color: C.textFaint, marginTop: 2, fontFamily: FONT_BODY.regular },
  unreadDot: {
    backgroundColor: C.accent, borderRadius: 999, minWidth: 22, height: 22,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  unreadText: { color: C.onAccent, fontSize: 11, fontFamily: FONT_BODY.bold },

  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1.5, borderColor: C.borderSoft, borderStyle: 'dashed', borderRadius: 18,
    paddingVertical: 15, marginTop: 6,
  },
  createBtnText: { color: C.accent, fontSize: 14, fontFamily: FONT_BODY.bold },
});
