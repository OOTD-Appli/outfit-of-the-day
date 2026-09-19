import { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/themeContext';
import { useToast } from '../lib/toastContext';

// Écran "Compétitions" (décision D2, UX_DESIGN.md) : la liste "Mes
// compétitions", jusqu'ici une section toujours visible en bas d'AccueilScreen,
// devient l'écran d'accueil de son propre onglet dédié.
//
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
  const { theme } = useTheme();
  const { showToast } = useToast();
  const s = useMemo(() => createStyles(theme), [theme]);

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
    } catch (e) {
      showToast(e?.message || 'Erreur chargement des compétitions', { type: 'error' });
    }
    setCompetitionsLoading(false);
  }, [showToast]);

  // Rafraîchi au focus (pas juste au montage) : l'onglet peut être revisité
  // après avoir créé/rejoint une compétition depuis un autre écran.
  useFocusEffect(useCallback(() => { fetchCompetitions(); }, [fetchCompetitions]));

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: theme.bg }]} edges={[]}>
      <View style={s.header}>
        <Text style={[s.headerTitle, { color: theme.textPri }]}>Compétitions</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.sectionHeader}>
          <Ionicons name="trophy-outline" size={16} color={theme.accent} />
          <Text style={[s.sectionTitle, { color: theme.textPri }]}>Mes compétitions</Text>
        </View>

        {competitionsLoading ? (
          <ActivityIndicator color={theme.accent} style={{ marginVertical: 12 }} />
        ) : competitions.length === 0 ? (
          <Text style={[s.emptyText, { color: theme.textSub }]}>
            Aucune compétition pour l'instant.
          </Text>
        ) : (
          competitions.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[s.competitionRow, { backgroundColor: theme.card, borderColor: theme.border }]}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('Competition', { competitionId: c.id, competitionName: c.name })}
            >
              <View style={[s.competitionIconWrap, { backgroundColor: theme.accent + '1A' }]}>
                <Ionicons name="people" size={18} color={theme.accent} />
              </View>
              <Text style={[s.competitionName, { color: theme.textPri }]} numberOfLines={1}>{c.name}</Text>
              {c.unread > 0 && (
                <View style={[s.competitionUnreadDot, { backgroundColor: theme.accent }]}>
                  <Text style={s.competitionUnreadText}>{c.unread > 9 ? '9+' : c.unread}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={theme.textSub} />
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity
          style={[s.createCompetitionBtn, { borderColor: theme.accent }]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('CreateCompetition')}
        >
          <Ionicons name="add-circle-outline" size={18} color={theme.accent} />
          <Text style={[s.createCompetitionText, { color: theme.accent }]}>Créer une compétition</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    safe: { flex: 1 },
    header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
    headerTitle: { fontSize: 26, fontWeight: '900' },
    scroll: { padding: 20, paddingBottom: 48 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    sectionTitle: { fontWeight: '800', fontSize: 17 },
    emptyText: { fontSize: 13, marginBottom: 10 },
    competitionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, marginBottom: 10 },
    competitionIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    competitionName: { flex: 1, fontWeight: '700', fontSize: 14.5 },
    competitionUnreadDot: { borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
    competitionUnreadText: { color: '#fff', fontSize: 10.5, fontWeight: '800' },
    createCompetitionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderRadius: 16, paddingVertical: 13, marginTop: 4 },
    createCompetitionText: { fontWeight: '800', fontSize: 14 },
  });
}
