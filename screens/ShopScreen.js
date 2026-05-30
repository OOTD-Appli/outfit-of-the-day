import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';

// ─── Catalogue ────────────────────────────────────────────────────────────────

const THEMES = [
  { id: 'default',  name: 'Rose Classique', emoji: '🌸', free: true },
  { id: 'midnight', name: 'Midnight Blue',   emoji: '🌙' },
  { id: 'emerald',  name: 'Emeraude',        emoji: '💚' },
  { id: 'gold',     name: 'Or Prestige',     emoji: '✨' },
  { id: 'sakura',   name: 'Sakura',          emoji: '🌺' },
];

const LOGOS = [
  { id: 'default', name: 'Classic',    emoji: '⭐', free: true },
  { id: 'diamond', name: 'Diamond',    emoji: '💎' },
  { id: 'crown',   name: 'Couronne',   emoji: '👑' },
  { id: 'fire',    name: 'Flamme',     emoji: '🔥' },
  { id: 'star',    name: 'Etoile Pro', emoji: '🌟' },
];

// Coût en points par type de cosmétique
const LOGO_PRICE  = 100;
const THEME_PRICE = 200;

// Coût en points pour débloquer un pass
const PASS_PRICES = {
  analysis: 400,  // Pass Analyse — 400 pts
  ootdplus:  500, // Pass OOTD+  — 500 pts
};

// Packs de points gagnables (non monétaires — récompenses d'activité)
const POINT_PACKS = [
  { id: 'sm', label: '+50 pts',  points: 50,  cost: '1 analyse partagée',  emoji: '📸' },
  { id: 'md', label: '+150 pts', points: 150, cost: '5 amis invités',       emoji: '👥', popular: true },
  { id: 'lg', label: '+150 pts', points: 150, cost: '10 tenues publiées',   emoji: '👗' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPts(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('fr-FR') + ' pts';
}

// ─── Composant ────────────────────────────────────────────────────────────────

export default function ShopScreen() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buying,  setBuying]  = useState(null);
  const { showToast } = useToast();
  const { refreshTheme } = useTheme();

  const fetchProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select(
        'points, daily_credits, credits_reset_date, ' +
        'has_analysis_pass, has_ootd_plus_pass, ' +
        'unlocked_themes, unlocked_logos, active_theme, active_logo'
      )
      .eq('id', user.id)
      .single();
    setProfile(data);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchProfile();
  }, [fetchProfile]));

  // ── Achat pass avec points ────────────────────────────────────────────────
  const buyPass = async (type) => {
    if (buying) return;
    setBuying(type);
    try {
      const { data, error } = await supabase.rpc('buy_pass', { pass_type: type });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erreur achat pass');
      const cost = PASS_PRICES[type];
      showToast(
        type === 'ootdplus'
          ? `Pass OOTD+ actif ! (−${fmtPts(cost)})`
          : `Pass Analyse actif ! (−${fmtPts(cost)})`,
        { type: 'success' }
      );
      fetchProfile();
    } catch (e) {
      showToast(e.message || 'Erreur', { type: 'error' });
    }
    setBuying(null);
  };

  // ── Achat cosmétique avec points ─────────────────────────────────────────
  const buyItem = async (itemType, itemId) => {
    if (buying) return;
    setBuying(itemType + '_' + itemId);
    try {
      const { data, error } = await supabase.rpc('buy_cosmetic', { item_type: itemType, item_id: itemId });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erreur achat');
      showToast(`Article débloqué ! (${fmtPts(data.new_points)} restants)`, { type: 'success' });
      fetchProfile();
    } catch (e) {
      showToast(e.message || 'Erreur', { type: 'error' });
    }
    setBuying(null);
  };

  // ── Équiper ──────────────────────────────────────────────────────────────
  const equipItem = async (itemType, itemId) => {
    if (buying) return;
    setBuying('equip_' + itemId);
    try {
      const { data, error } = await supabase.rpc('equip_cosmetic', { item_type: itemType, item_id: itemId });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Équipement impossible');
      showToast('Style appliqué !', { type: 'success' });
      await refreshTheme();
      fetchProfile();
    } catch (e) {
      showToast(e.message || 'Erreur', { type: 'error' });
    }
    setBuying(null);
  };

  // ── État calculé ─────────────────────────────────────────────────────────
  const hasPlus     = !!profile?.has_ootd_plus_pass;
  const hasAnalysis = !!profile?.has_analysis_pass;
  const hasAnyPass  = hasPlus || hasAnalysis;
  const maxCreds    = hasAnyPass ? 20 : 2;
  const today       = new Date().toISOString().split('T')[0];
  const credsToday  = (profile?.credits_reset_date < today ? maxCreds : (profile?.daily_credits ?? 0));

  const isThemeOwned = (id) => id === 'default' || hasPlus || (profile?.unlocked_themes || []).includes(id);
  const isLogoOwned  = (id) => id === 'default' || hasPlus || (profile?.unlocked_logos  || []).includes(id);
  const pts          = profile?.points || 0;

  // ── Render cosmétique ────────────────────────────────────────────────────
  const renderCosItem = (item, itemType) => {
    const owned    = itemType === 'theme' ? isThemeOwned(item.id) : isLogoOwned(item.id);
    const isActive = itemType === 'theme'
      ? profile?.active_theme === item.id
      : profile?.active_logo  === item.id;
    const isBuying  = buying === itemType + '_' + item.id;
    const price     = itemType === 'theme' ? THEME_PRICE : LOGO_PRICE;
    const canAfford = pts >= price;

    return (
      <View key={item.id} style={[s.cosCard, owned && s.cosCardOwned, isActive && s.cosCardActive]}>
        <Text style={s.cosEmoji}>{item.emoji}</Text>
        <Text style={s.cosName} numberOfLines={2}>{item.name}</Text>

        {isActive ? (
          <View style={s.equippedBadge}><Text style={s.equippedText}>Équipé</Text></View>
        ) : owned ? (
          <TouchableOpacity
            style={s.cosEquipBtn}
            onPress={() => equipItem(itemType, item.id)}
            disabled={!!buying}
          >
            {buying === 'equip_' + item.id
              ? <ActivityIndicator color="#39FF14" size="small" />
              : <Text style={s.cosEquipText}>Équiper</Text>}
          </TouchableOpacity>
        ) : item.free ? (
          <View style={s.cosFreeTag}><Text style={s.cosFreeText}>Gratuit</Text></View>
        ) : (
          <TouchableOpacity
            style={[s.cosBuyBtn, !canAfford && s.cosBuyBtnDis]}
            onPress={() => buyItem(itemType, item.id)}
            disabled={!!buying || !canAfford}
          >
            {isBuying
              ? <ActivityIndicator color="#0a0a0a" size="small" />
              : <Text style={[s.cosBuyText, !canAfford && s.cosBuyTextDis]}>{fmtPts(price)}</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.bg}>
        <ActivityIndicator color="#39FF14" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  // ── Vue principale ───────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.bg}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── Header ────────────────────────────────────────── */}
        <View style={s.header}>
          <Text style={s.headerTitle}>SHOP</Text>
          <Text style={s.headerSub}>Dépense tes points OOTD pour débloquer des cosmétiques</Text>
        </View>

        {/* ── Stats ─────────────────────────────────────────── */}
        <View style={s.statsCard}>
          <View style={s.statCol}>
            <Text style={s.statVal}>{fmtPts(pts)}</Text>
            <Text style={s.statLbl}>Points OOTD</Text>
          </View>
          <View style={s.statDiv} />
          <View style={s.statCol}>
            <Text style={s.statVal}>{credsToday}/{maxCreds}</Text>
            <Text style={s.statLbl}>Analyses aujourd'hui</Text>
          </View>
          <View style={s.statDiv} />
          <View style={s.statCol}>
            <Text style={[s.statVal, hasAnyPass && { color: '#39FF14' }]}>
              {hasPlus ? 'OOTD+' : hasAnalysis ? 'Analyse' : 'Aucun'}
            </Text>
            <Text style={s.statLbl}>Pass actif</Text>
          </View>
        </View>

        {/* ── Section A : Pass Premium ───────────────────────── */}
        <Text style={s.sectionTitle}>PASS PREMIUM</Text>
        <Text style={s.sectionSub}>Déblocable avec tes points OOTD</Text>

        {/* Pass Analyse */}
        <View style={[s.passCard, hasAnalysis && s.passCardOwned]}>
          {hasAnalysis && (
            <View style={s.activeBadge}><Text style={s.activeBadgeText}>ACTIF</Text></View>
          )}
          <Text style={s.passEmoji}>🔬</Text>
          <View style={s.passInfo}>
            <Text style={s.passName}>Pass Analyse</Text>
            <Text style={s.passDesc}>20 analyses / jour au lieu de 2</Text>
          </View>
          <TouchableOpacity
            style={[s.passBtn, hasAnalysis && s.passBtnOwned, pts < PASS_PRICES.analysis && !hasAnalysis && s.passBtnDis]}
            onPress={() => buyPass('analysis')}
            disabled={!!hasAnalysis || !!buying}
          >
            {buying === 'analysis'
              ? <ActivityIndicator color="#0a0a0a" size="small" />
              : <Text style={[s.passBtnTxt, hasAnalysis && s.passBtnTxtOwned, pts < PASS_PRICES.analysis && !hasAnalysis && s.passBtnTxtDis]}>
                  {hasAnalysis ? 'Actif' : fmtPts(PASS_PRICES.analysis)}
                </Text>}
          </TouchableOpacity>
        </View>

        {/* Pass OOTD+ */}
        <View style={[s.passCard, s.passCardPlus, hasPlus && s.passCardOwned]}>
          <View style={s.popularBadge}><Text style={s.popularTxt}>POPULAIRE</Text></View>
          {hasPlus && (
            <View style={[s.activeBadge, { left: undefined, right: 12 }]}>
              <Text style={s.activeBadgeText}>ACTIF</Text>
            </View>
          )}
          <Text style={s.passEmoji}>👑</Text>
          <View style={s.passInfo}>
            <Text style={[s.passName, { color: '#39FF14' }]}>Pass OOTD+</Text>
            <Text style={s.passDesc}>20 analyses / jour + TOUS les thèmes et logos</Text>
          </View>
          <TouchableOpacity
            style={[s.passBtn, s.passBtnPlus, hasPlus && s.passBtnOwned, pts < PASS_PRICES.ootdplus && !hasPlus && s.passBtnDis]}
            onPress={() => buyPass('ootdplus')}
            disabled={!!hasPlus || !!buying}
          >
            {buying === 'ootdplus'
              ? <ActivityIndicator color="#0a0a0a" size="small" />
              : <Text style={[s.passBtnTxt, hasPlus && s.passBtnTxtOwned, pts < PASS_PRICES.ootdplus && !hasPlus && s.passBtnTxtDis]}>
                  {hasPlus ? 'Actif' : fmtPts(PASS_PRICES.ootdplus)}
                </Text>}
          </TouchableOpacity>
        </View>

        {/* ── Section B : Thèmes ────────────────────────────── */}
        <Text style={s.sectionTitle}>THÈMES</Text>
        <Text style={s.sectionSub}>200 pts — offerts avec le Pass OOTD+</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.hScroll} contentContainerStyle={s.hContent}>
          {THEMES.map(t => renderCosItem(t, 'theme'))}
        </ScrollView>

        {/* ── Section C : Logos ─────────────────────────────── */}
        <Text style={s.sectionTitle}>LOGOS</Text>
        <Text style={s.sectionSub}>100 pts — offerts avec le Pass OOTD+</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.hScroll} contentContainerStyle={s.hContent}>
          {LOGOS.map(l => renderCosItem(l, 'logo'))}
        </ScrollView>

        {/* ── Section D : Gagner des points ─────────────────── */}
        <Text style={s.sectionTitle}>GAGNER DES POINTS</Text>
        <Text style={s.sectionSub}>Points gagnés automatiquement en utilisant l'app</Text>
        {POINT_PACKS.map(pack => (
          <View
            key={pack.id}
            style={[s.packRow, pack.popular && s.packRowPop]}
          >
            {pack.popular && (
              <View style={s.packPopBadge}><Text style={s.packPopTxt}>MEILLEURE VALEUR</Text></View>
            )}
            <View style={s.packLeft}>
              <Text style={[s.packPts, pack.popular && { color: '#39FF14' }]}>{pack.label}</Text>
              <Text style={s.packHint}>{pack.cost}</Text>
            </View>
            <View style={[s.packChip, pack.popular && s.packChipPop]}>
              <Text style={[s.packEmoji]}>{pack.emoji}</Text>
            </View>
          </View>
        ))}

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const NEON   = '#39FF14';
const BG     = '#0a0a0a';
const CARD   = '#111111';
const BORDER = '#1e1e1e';
const WHITE  = '#FFFFFF';
const GRAY   = '#888888';

const s = StyleSheet.create({
  bg:     { flex: 1, backgroundColor: BG },
  scroll: { padding: 20, paddingTop: 12 },

  header:     { marginBottom: 20 },
  headerTitle:{ fontSize: 28, fontWeight: '900', color: WHITE, letterSpacing: 3 },
  headerSub:  { fontSize: 12, color: GRAY, marginTop: 2 },

  statsCard: {
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    flexDirection: 'row', padding: 16, marginBottom: 28, alignItems: 'center',
  },
  statCol:  { flex: 1, alignItems: 'center' },
  statDiv:  { width: 1, height: 36, backgroundColor: BORDER },
  statVal:  { fontSize: 14, fontWeight: '800', color: WHITE, marginBottom: 2 },
  statLbl:  { fontSize: 10, color: GRAY },

  sectionTitle: { fontSize: 11, fontWeight: '800', color: NEON, letterSpacing: 2, marginBottom: 4, marginTop: 8 },
  sectionSub:   { fontSize: 11, color: GRAY, marginBottom: 14 },

  passCard: {
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    padding: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12,
  },
  passCardPlus:  { borderColor: '#2a3a1a' },
  passCardOwned: { borderColor: '#39FF1433', opacity: 0.85 },
  passEmoji:     { fontSize: 28 },
  passInfo:      { flex: 1 },
  passName:      { fontSize: 14, fontWeight: '800', color: WHITE, marginBottom: 2 },
  passDesc:      { fontSize: 11, color: GRAY, lineHeight: 16 },

  passBtn: {
    backgroundColor: WHITE, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, minWidth: 80, alignItems: 'center',
  },
  passBtnPlus:    { backgroundColor: NEON },
  passBtnOwned:   { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: BORDER },
  passBtnDis:     { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: BORDER },
  passBtnTxt:     { fontSize: 11, fontWeight: '800', color: '#0a0a0a' },
  passBtnTxtOwned:{ color: GRAY },
  passBtnTxtDis:  { color: '#444' },

  popularBadge: {
    position: 'absolute', top: -1, left: 16,
    backgroundColor: NEON, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2,
  },
  popularTxt:  { fontSize: 9, fontWeight: '900', color: '#0a0a0a', letterSpacing: 1 },
  activeBadge: {
    position: 'absolute', top: -1, left: 16,
    backgroundColor: '#1a3a1a', borderWidth: 1, borderColor: NEON,
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2,
  },
  activeBadgeText: { fontSize: 9, fontWeight: '900', color: NEON, letterSpacing: 1 },

  hScroll:   { marginBottom: 24 },
  hContent:  { gap: 10, paddingRight: 4 },
  cosCard: {
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    width: 120, padding: 14, alignItems: 'center', gap: 8,
  },
  cosCardOwned:  { borderColor: '#39FF1444' },
  cosCardActive: { borderColor: NEON, borderWidth: 2 },
  cosEmoji:      { fontSize: 32 },
  cosName:       { fontSize: 11, fontWeight: '700', color: WHITE, textAlign: 'center' },

  equippedBadge: { backgroundColor: '#0d2a0d', borderWidth: 1, borderColor: NEON, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  equippedText:  { fontSize: 10, fontWeight: '800', color: NEON },
  cosEquipBtn:   { backgroundColor: '#1a2a1a', borderWidth: 1, borderColor: NEON, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  cosEquipText:  { fontSize: 10, fontWeight: '800', color: NEON },
  cosFreeTag:    { backgroundColor: '#1a1a1a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  cosFreeText:   { fontSize: 10, color: GRAY },
  cosBuyBtn:     { backgroundColor: NEON, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  cosBuyBtnDis:  { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: BORDER },
  cosBuyText:    { fontSize: 10, fontWeight: '800', color: '#0a0a0a' },
  cosBuyTextDis: { color: GRAY },

  packRow: {
    backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 10, gap: 12,
  },
  packRowPop:   { borderColor: '#2a3a1a' },
  packLeft:     { flex: 1 },
  packPts:      { fontSize: 15, fontWeight: '800', color: WHITE, marginBottom: 2 },
  packHint:     { fontSize: 11, color: GRAY },
  packChip:     { backgroundColor: '#1e1e1e', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: BORDER },
  packChipPop:  { backgroundColor: '#1a2a1a', borderColor: NEON },
  packEmoji:    { fontSize: 20 },
  packPopBadge: { position: 'absolute', top: -1, right: 16, backgroundColor: NEON, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  packPopTxt:   { fontSize: 9, fontWeight: '900', color: '#0a0a0a', letterSpacing: 1 },
});
