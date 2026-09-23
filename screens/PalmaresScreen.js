import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect } from 'react-native-svg';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/themeContext';
import Avatar from '../components/Avatar';

// Décision D3 (UX_DESIGN.md) : pas de chat public en V1 (risque modération/harcèlement
// sur une app qui note l'apparence) → écran Palmarès dédié à la place (podium + graphique).

const MEDALS = ['🥇', '🥈', '🥉'];

function formatScore(value) {
  const num = Number(value);
  return Number.isFinite(num) ? String(Math.round(num)) : '–';
}

// Barres verticales simples (jusqu'à 3) : hauteur ∝ score/100. "score" est un
// meilleur score (période "Jour") ou une moyenne (autres périodes) selon
// get_top3_app/get_top3_friends (2026-09-30) — cet écran n'exposant que
// Semaine/Mois, c'est toujours une moyenne ici en pratique.
// La barre de l'utilisateur courant ressort avec une couleur dédiée.
function ScoreBarChart({ data, currentUserId, theme }) {
  const chartHeight = 120;
  const barWidth = 46;
  const gap = 28;
  const width = data.length * barWidth + (data.length - 1) * gap + 24;

  return (
    <View style={styles.chartWrap}>
      <Svg width={width} height={chartHeight}>
        {data.map((row, i) => {
          const score = Number(row.score) || 0;
          const barHeight = Math.max(4, Math.min(chartHeight, (score / 100) * chartHeight));
          const x = 12 + i * (barWidth + gap);
          const y = chartHeight - barHeight;
          const isMe = currentUserId && row.user_id === currentUserId;
          return (
            <Rect
              key={row.user_id}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              rx={8}
              fill={isMe ? theme.accent : theme.border}
              stroke={isMe ? theme.accent : 'transparent'}
              strokeWidth={isMe ? 2 : 0}
            />
          );
        })}
      </Svg>
      <View style={[styles.chartLabels, { width }]}>
        {data.map((row) => (
          <View key={row.user_id} style={{ width: barWidth + gap, alignItems: 'center' }}>
            <Text style={[styles.chartLabelName, { color: theme.textSub }]} numberOfLines={1}>
              {row.username}
            </Text>
            <Text style={[styles.chartLabelScore, { color: theme.textPri }]}>{formatScore(row.score)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Top3Block({ title, data, emptyLabel, theme }) {
  return (
    <View style={styles.block}>
      <Text style={[styles.blockTitle, { color: theme.textPri }]}>{title}</Text>
      {data.length === 0 ? (
        <Text style={[styles.emptyText, { color: theme.textSub }]}>{emptyLabel}</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {data.map((row, i) => (
            <View key={row.user_id} style={[styles.row, { backgroundColor: theme.card }]}>
              <Text style={styles.medal}>{MEDALS[i] || `${i + 1}`}</Text>
              <Avatar uri={row.avatar_url} username={row.username} size={36} />
              <Text style={[styles.rowName, { color: theme.textPri }]} numberOfLines={1}>{row.username}</Text>
              <Text style={[styles.rowScore, { color: theme.accent }]}>{formatScore(row.score)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export default function PalmaresScreen({ navigation }) {
  const { theme } = useTheme();
  const [period, setPeriod] = useState('week');
  const [top3App, setTop3App] = useState([]);
  const [top3Friends, setTop3Friends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (mounted) setCurrentUserId(user?.id || null);
    })();
    return () => { mounted = false; };
  }, []);

  const fetchPalmares = useCallback(async () => {
    setLoading(true);
    const [{ data: app }, { data: friends }] = await Promise.all([
      supabase.rpc('get_top3_app', { p_period: period }),
      supabase.rpc('get_top3_friends', { p_period: period }),
    ]);
    setTop3App(app || []);
    setTop3Friends(friends || []);
    setLoading(false);
  }, [period]);

  useEffect(() => { fetchPalmares(); }, [fetchPalmares]);

  useFocusEffect(
    useCallback(() => {
      fetchPalmares();
    }, [fetchPalmares])
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={theme.textPri} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.textPri }]}>Palmarès</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.periodRow}>
        <View style={[styles.periodPill, { backgroundColor: theme.card }]}>
          <TouchableOpacity
            style={[styles.periodBtn, period === 'week' && { backgroundColor: theme.accent }]}
            onPress={() => setPeriod('week')}
            activeOpacity={0.85}
          >
            <Text style={[styles.periodText, { color: period === 'week' ? '#fff' : theme.textSub }]}>Semaine</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.periodBtn, period === 'month' && { backgroundColor: theme.accent }]}
            onPress={() => setPeriod('month')}
            activeOpacity={0.85}
          >
            <Text style={[styles.periodText, { color: period === 'month' ? '#fff' : theme.textSub }]}>Mois</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          <Top3Block
            title="🏆 Top 3 de l'app"
            data={top3App}
            emptyLabel="Pas encore de classement sur cette période."
            theme={theme}
          />

          {top3App.length > 0 && (
            <ScoreBarChart data={top3App} currentUserId={currentUserId} theme={theme} />
          )}

          <Top3Block
            title="👯 Top 3 entre amis"
            data={top3Friends}
            emptyLabel="Pas encore de classement entre amis sur cette période."
            theme={theme}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 16, fontWeight: '800' },

  periodRow: { alignItems: 'center', paddingTop: 16, paddingBottom: 4 },
  periodPill: { flexDirection: 'row', borderRadius: 20, padding: 4 },
  periodBtn: { paddingHorizontal: 20, paddingVertical: 8, borderRadius: 16 },
  periodText: { fontWeight: '700', fontSize: 13 },

  body: { padding: 16, paddingBottom: 40, gap: 24 },

  block: { gap: 10 },
  blockTitle: { fontWeight: '800', fontSize: 16 },
  emptyText: { fontSize: 13, fontStyle: 'italic' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 10 },
  medal: { fontSize: 18, width: 26, textAlign: 'center' },
  rowName: { flex: 1, fontWeight: '600', fontSize: 14 },
  rowScore: { fontWeight: '800', fontSize: 14 },

  chartWrap: { alignItems: 'center', paddingVertical: 8 },
  chartLabels: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  chartLabelName: { fontSize: 10, maxWidth: 60 },
  chartLabelScore: { fontSize: 12, fontWeight: '800', marginTop: 1 },
});
