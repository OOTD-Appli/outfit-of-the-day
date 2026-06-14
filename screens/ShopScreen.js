import { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image, Platform,
  TouchableOpacity, ActivityIndicator, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';

// ─── Catalogue cosmétiques (économie points, inchangée) ─────────────────────────

const THEMES = [
  { id: 'default',  name: 'Rose Classique', emoji: '🌸', free: true },
  { id: 'midnight', name: 'Midnight Blue',  emoji: '🌙' },
  { id: 'emerald',  name: 'Émeraude',       emoji: '💚' },
  { id: 'gold',     name: 'Or Prestige',    emoji: '✨' },
  { id: 'sakura',   name: 'Sakura',         emoji: '🌺' },
];

// Icônes de profil — badges affichés sur l'avatar et les posts
const ICONS = [
  { id: 'default',  name: 'Classic',    emoji: '⭐', free: true },
  { id: 'diamond',  name: 'Diamond',    emoji: '💎' },
  { id: 'crown',    name: 'Couronne',   emoji: '👑' },
  { id: 'fire',     name: 'Flamme',     emoji: '🔥' },
  { id: 'star',     name: 'Étoile Pro', emoji: '🌟' },
];

// Logos visuels — changent l'icône de l'app et l'identité visuelle
const LOGOS = [
  { id: 'bleu_neon',   name: 'Bleu Neon',   image: require('../assets/logos/bleu_neon.jpg') },
  { id: 'sunset',      name: 'Sunset',      image: require('../assets/logos/sunset.jpg') },
  { id: 'vert_neon',   name: 'Vert Neon',   image: require('../assets/logos/vert_neon.jpg') },
  { id: 'rose_flashy', name: 'Rose Flashy', image: require('../assets/logos/rose_flashy.jpg') },
  { id: 'rose_pastel', name: 'Rose Pastel', image: require('../assets/logos/rose_pastel.jpg') },
];

// Prix par rareté — DOIT rester aligné avec buy_cosmetic côté serveur (migration new_logo_variants)
const THEME_PRICES = { midnight: 1000, emerald: 1000, gold: 1500, sakura: 1500 };
const ICON_PRICES  = { fire: 150, diamond: 200, star: 200, crown: 200 };
const LOGO_PRICES  = { bleu_neon: 500, sunset: 600, vert_neon: 500, rose_flashy: 650, rose_pastel: 750 };

// Achats express Stripe (paiement unique en euros, crédit posé par le webhook)
const EXPRESS = [
  { product: 'flame_freeze', emoji: '🧊', name: 'Gel de Flamme',      desc: 'Protège une de tes séries 🔥 lors d\'un oubli', price: '0,99€' },
  { product: 'points_2000',  emoji: '🪙', name: 'Pack de 2 000 Points', desc: 'Crédité instantanément sur ton profil',        price: '0,99€' },
];

// ─── Abonnements Premium (Stripe) ───────────────────────────────────────────────

const PLANS = [
  {
    id: 'plus',
    name: 'OOTD Plus',
    price: '2,99€',
    icon: 'star',
    perks: [
      '20 analyses IA par jour',
      'Badge premium sur ton profil',
      'Historique complet de tes OOTD',
    ],
  },
  {
    id: 'elite',
    name: 'OOTD Elite',
    price: '4,99€',
    icon: 'diamond',
    highlight: true,
    perks: [
      'Analyses IA illimitées',
      'Tous les thèmes & logos débloqués',
      'Badge Elite exclusif',
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPts(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('fr-FR') + ' pts';
}

function fmtDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }); }
  catch (_) { return null; }
}

// ─── Composant ────────────────────────────────────────────────────────────────

export default function ShopScreen() {
  const [profile, setProfile] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buying,  setBuying]  = useState(null);
  const { showToast } = useToast();
  const { theme, refreshTheme } = useTheme();
  const firstFocus = useRef(true);

  // silent = rechargement en arrière-plan (sans spinner) — utilisé au retour sur
  // l'écran, notamment après un paiement Stripe via le deep link ootd://shop.
  const fetchData = useCallback(async (opts = {}) => {
    const { silent = false } = opts;
    if (!silent) setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    // Verse les gels gratuits du mois si dû (idempotent côté serveur)
    try { await supabase.rpc('claim_monthly_freezes'); } catch (_) {}
    const [{ data: prof }, { data: sub }] = await Promise.all([
      supabase
        .from('profiles')
        .select(
          'points, flame_freezes, daily_credits, credits_reset_date, ' +
          'has_analysis_pass, has_ootd_plus_pass, ' +
          'unlocked_themes, unlocked_logos, active_theme, active_logo'
        )
        .eq('id', user.id)
        .single(),
      supabase
        .from('subscriptions')
        .select('status, plan_type, current_period_end, cancel_at_period_end')
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);
    setProfile(prof);
    setSubscription(sub);
    if (!silent) setLoading(false);
  }, []);

  // Recharge à chaque focus : 1er affichage avec spinner, puis refresh silencieux
  // (points, abonnement, gels, cosmétiques) sans avoir à changer d'onglet.
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; fetchData(); }
    else { fetchData({ silent: true }); }
  }, [fetchData]));

  // ── Abonnement Stripe : checkout ──────────────────────────────────────────
  const startCheckout = async (planType) => {
    if (buying) return;
    setBuying('sub_' + planType);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { plan_type: planType },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'Lien de paiement indisponible');
      await Linking.openURL(data.url);
    } catch (e) {
      showToast(e.message || 'Paiement indisponible', { type: 'error' });
    }
    setBuying(null);
  };

  // ── Abonnement Stripe : portail de gestion ────────────────────────────────
  const openPortal = async () => {
    if (buying) return;
    setBuying('portal');
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session', {});
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'Portail indisponible');
      await Linking.openURL(data.url);
    } catch (e) {
      showToast(e.message || 'Portail indisponible', { type: 'error' });
    }
    setBuying(null);
  };

  // ── Achats express Stripe (paiement unique en euros) ───────────────────────
  // Le crédit (points / gel) est posé côté serveur par le webhook, pas ici.
  const startPayment = async (product) => {
    if (buying) return;
    setBuying('pay_' + product);
    try {
      const { data, error } = await supabase.functions.invoke('create-payment-session', {
        body: { product },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'Paiement indisponible');
      await Linking.openURL(data.url);
    } catch (e) {
      showToast(e.message || 'Paiement indisponible', { type: 'error' });
    }
    setBuying(null);
  };

  const buyItem = async (itemType, itemId) => {
    if (buying) return;
    setBuying(itemType + '_' + itemId);
    try {
      const { data, error } = await supabase.rpc('buy_cosmetic', { item_type: itemType, item_id: itemId });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Erreur achat');
      showToast(`Article débloqué ! (${fmtPts(data.new_points)} restants)`, { type: 'success' });
      fetchData();
    } catch (e) {
      showToast(e.message || 'Erreur', { type: 'error' });
    }
    setBuying(null);
  };

  // Pop-up de confirmation avant un achat cosmétique en points
  const confirmBuyItem = (itemType, item, price) => {
    if (buying) return;
    Alert.alert(
      'Confirmer l\'achat',
      `Débloquer « ${item.name} » pour ${fmtPts(price)} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Acheter', onPress: () => buyItem(itemType, item.id) },
      ],
    );
  };

  const equipItem = async (itemType, itemId) => {
    if (buying) return;
    setBuying('equip_' + itemId);
    try {
      const { data, error } = await supabase.rpc('equip_cosmetic', { item_type: itemType, item_id: itemId });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Équipement impossible');
      showToast('Style appliqué !', { type: 'success' });
      await refreshTheme();
      // Web : met à jour le favicon avec le nouveau logo
      if (itemType === 'logo' && Platform.OS === 'web' && typeof document !== 'undefined') {
        const logoItem = LOGOS.find(l => l.id === itemId);
        if (logoItem?.image) {
          try {
            const { uri } = Image.resolveAssetSource(logoItem.image);
            let link = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
            if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
            link.href = uri;
          } catch (_) {}
        }
      }
      fetchData();
    } catch (e) {
      showToast(e.message || 'Erreur', { type: 'error' });
    }
    setBuying(null);
  };

  // ── État calculé ───────────────────────────────────────────────────────────
  const subActive   = subscription && ['active', 'trialing'].includes(subscription.status);
  const activePlan  = subActive ? subscription.plan_type : null;
  const isElite     = activePlan === 'elite';
  const renewalDate = fmtDate(subscription?.current_period_end);

  const hasPlus     = !!profile?.has_ootd_plus_pass;
  const hasAnalysis = !!profile?.has_analysis_pass;
  const hasAnyPass  = hasPlus || hasAnalysis || subActive;
  const today       = new Date().toISOString().split('T')[0];
  const freezes     = profile?.flame_freezes || 0;
  const numBaseMax  = isElite ? Infinity : (hasPlus || hasAnalysis || activePlan === 'plus') ? 20 : 2;
  const liveToday   = profile?.credits_reset_date < today ? 0 : (profile?.daily_credits ?? 0);
  // Le Pass Analyse 24h pousse daily_credits à 20 sans poser de pass permanent :
  // on reflète ce boost dans le plafond affiché du jour.
  const maxCreds    = isElite ? '∞' : Math.max(numBaseMax, liveToday);
  const credsToday  = isElite
    ? '∞'
    : (profile?.credits_reset_date < today ? numBaseMax : (profile?.daily_credits ?? 0));

  const isThemeOwned = (id) => id === 'default' || isElite || hasPlus || (profile?.unlocked_themes || []).includes(id);
  const isLogoOwned  = (id) => id === 'default' || isElite || hasPlus || (profile?.unlocked_logos  || []).includes(id);
  const pts          = profile?.points || 0;

  // ── Render cosmétique ──────────────────────────────────────────────────────
  // priceMap permet de distinguer ICON_PRICES et LOGO_PRICES pour les deux sous-sections logo
  const renderCosItem = (item, itemType, priceMap) => {
    const owned     = itemType === 'theme' ? isThemeOwned(item.id) : isLogoOwned(item.id);
    const isActive  = itemType === 'theme' ? profile?.active_theme === item.id : profile?.active_logo === item.id;
    const isBuying  = buying === itemType + '_' + item.id;
    const price     = priceMap ? priceMap[item.id] : (itemType === 'theme' ? THEME_PRICES[item.id] : ICON_PRICES[item.id]);
    const canAfford = pts >= price;

    return (
      <View key={item.id} style={[s.cosCard, { backgroundColor: theme.card, borderColor: theme.border }, isActive && { borderColor: theme.accent, borderWidth: 2 }]}>
        {item.image
          ? <Image source={item.image} style={s.cosImg} />
          : <Text style={s.cosEmoji}>{item.emoji}</Text>
        }
        <Text style={[s.cosName, { color: theme.textPri }]} numberOfLines={2}>{item.name}</Text>
        {!item.free && price != null && (
          <Text style={[s.cosPriceLbl, { color: theme.textSub }]}>{fmtPts(price)}</Text>
        )}

        {isActive ? (
          <View style={[s.tag, { backgroundColor: theme.accent }]}><Text style={s.tagTextLight}>Équipé</Text></View>
        ) : owned ? (
          <TouchableOpacity style={[s.equipBtn, { borderColor: theme.accent }]} onPress={() => equipItem(itemType, item.id)} disabled={!!buying}>
            {buying === 'equip_' + item.id
              ? <ActivityIndicator color={theme.accent} size="small" />
              : <Text style={[s.equipText, { color: theme.accent }]}>Équiper</Text>}
          </TouchableOpacity>
        ) : item.free ? (
          <View style={[s.tag, { backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border }]}><Text style={[s.tagText, { color: theme.textSub }]}>Gratuit</Text></View>
        ) : (
          <TouchableOpacity
            style={[s.buyBtn, { backgroundColor: theme.accent }, !canAfford && { backgroundColor: theme.border }]}
            onPress={() => confirmBuyItem(itemType, item, price)}
            disabled={!!buying || !canAfford}
          >
            {isBuying
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={[s.buyText, !canAfford && { color: theme.textSub }]}>Acheter</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ── Render carte plan abonnement ─────────────────────────────────────────────
  const renderPlan = (plan) => {
    const thisActive = activePlan === plan.id;
    const busyThis   = buying === 'sub_' + plan.id;

    return (
      <View
        key={plan.id}
        style={[
          s.planCard,
          { backgroundColor: theme.card, borderColor: theme.border },
          plan.highlight && { borderColor: theme.accent },
          thisActive && { borderColor: theme.accent, borderWidth: 2 },
        ]}
      >
        {plan.highlight && !thisActive && (
          <View style={[s.planBadge, { backgroundColor: theme.accent }]}><Text style={s.planBadgeText}>POPULAIRE</Text></View>
        )}
        {thisActive && (
          <View style={[s.planBadge, { backgroundColor: theme.accent }]}><Text style={s.planBadgeText}>ACTIF</Text></View>
        )}

        <View style={s.planHead}>
          <View style={[s.planIcon, { backgroundColor: theme.accent + '1A' }]}>
            <Ionicons name={plan.icon} size={20} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.planName, { color: theme.textPri }]}>{plan.name}</Text>
            <Text style={[s.planPrice, { color: theme.accent }]}>{plan.price}<Text style={[s.planPer, { color: theme.textSub }]}> / mois</Text></Text>
          </View>
        </View>

        <View style={s.planPerks}>
          {plan.perks.map((perk, i) => (
            <View key={i} style={s.perkRow}>
              <Ionicons name="checkmark-circle" size={16} color={theme.accent} />
              <Text style={[s.perkText, { color: theme.textPri }]}>{perk}</Text>
            </View>
          ))}
        </View>

        {thisActive ? (
          <>
            {renewalDate && (
              <Text style={[s.renewText, { color: theme.textSub }]}>
                {subscription?.cancel_at_period_end
                  ? `Se termine le ${renewalDate}`
                  : `Renouvellement le ${renewalDate}`}
              </Text>
            )}
            <TouchableOpacity style={[s.manageBtn, { borderColor: theme.accent }]} onPress={openPortal} disabled={!!buying}>
              {buying === 'portal'
                ? <ActivityIndicator color={theme.accent} size="small" />
                : <Text style={[s.manageText, { color: theme.accent }]}>Gérer mon abonnement</Text>}
            </TouchableOpacity>
          </>
        ) : subActive ? (
          <TouchableOpacity style={[s.manageBtn, { borderColor: theme.accent }]} onPress={openPortal} disabled={!!buying}>
            {buying === 'portal'
              ? <ActivityIndicator color={theme.accent} size="small" />
              : <Text style={[s.manageText, { color: theme.accent }]}>Changer d'offre</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[s.subBtn, { backgroundColor: theme.accent }]} onPress={() => startCheckout(plan.id)} disabled={!!buying}>
            {busyThis
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.subText}>S'abonner</Text>}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[s.bg, { backgroundColor: theme.bg }]} edges={[]}>
        <ActivityIndicator color={theme.accent} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.bg, { backgroundColor: theme.bg }]} edges={[]}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={s.header}>
          <Text style={[s.headerTitle, { color: theme.textPri }]}>Boutique</Text>
          <Text style={[s.headerSub, { color: theme.textSub }]}>Premium par abonnement · cosmétiques avec tes points</Text>
        </View>

        {/* Compteur de gels de flamme */}
        <View style={[s.freezeChip, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Text style={[s.freezeChipText, { color: theme.textPri }]}>
            ❄️ Gels de flamme : <Text style={{ color: theme.accent, fontWeight: '900' }}>{freezes}</Text>
          </Text>
        </View>

        {/* Stats */}
        <View style={[s.statsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={s.statCol}>
            <Text style={[s.statVal, { color: theme.textPri }]}>{fmtPts(pts)}</Text>
            <Text style={[s.statLbl, { color: theme.textSub }]}>Points OOTD</Text>
          </View>
          <View style={[s.statDiv, { backgroundColor: theme.border }]} />
          <View style={s.statCol}>
            <Text style={[s.statVal, { color: theme.textPri }]}>{credsToday}/{maxCreds}</Text>
            <Text style={[s.statLbl, { color: theme.textSub }]}>Analyses du jour</Text>
          </View>
          <View style={[s.statDiv, { backgroundColor: theme.border }]} />
          <View style={s.statCol}>
            <Text style={[s.statVal, { color: hasAnyPass ? theme.accent : theme.textPri }]}>
              {isElite ? 'Elite' : activePlan === 'plus' ? 'Plus' : hasPlus ? 'OOTD+' : hasAnalysis ? 'Analyse' : 'Gratuit'}
            </Text>
            <Text style={[s.statLbl, { color: theme.textSub }]}>Formule</Text>
          </View>
        </View>

        {/* ── Section 1 : Abonnements Premium (Stripe) ── */}
        <Text style={[s.sectionTitle, { color: theme.textPri }]}>✨ Premium</Text>
        <Text style={[s.sectionSub, { color: theme.textSub }]}>Abonnement mensuel sécurisé via Stripe</Text>
        {PLANS.map(renderPlan)}

        {/* ── Section 2 : Achats Express (Stripe, paiement unique) ── */}
        <Text style={[s.sectionTitle, { color: theme.textPri, marginTop: 18 }]}>⚡ Achats Express</Text>
        <Text style={[s.sectionSub, { color: theme.textSub }]}>Micro-achats en euros, crédités instantanément</Text>
        {EXPRESS.map((item) => {
          const busyThis  = buying === 'pay_' + item.product;
          const showStock = item.product === 'flame_freeze' && freezes > 0;
          return (
            <View key={item.product} style={[s.passRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <Text style={s.cosEmoji}>{item.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.passName, { color: theme.textPri }]}>
                  {item.name}{showStock ? ` · ${freezes} en stock` : ''}
                </Text>
                <Text style={[s.passDesc, { color: theme.textSub }]}>{item.desc}</Text>
              </View>
              <TouchableOpacity
                style={[s.passBtn, { backgroundColor: theme.accent }]}
                onPress={() => startPayment(item.product)}
                disabled={!!buying}
              >
                {busyThis
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.passBtnTxt}>{item.price}</Text>}
              </TouchableOpacity>
            </View>
          );
        })}

        {/* ── Section 3 : Boutique Points (cosmétiques) ── */}
        <Text style={[s.sectionTitle, { color: theme.textPri, marginTop: 18 }]}>🪙 Boutique Points</Text>
        <Text style={[s.sectionSub, { color: theme.textSub }]}>Débloque des cosmétiques avec tes points OOTD</Text>

        {/* 3a — Thèmes */}
        <Text style={[s.subSection, { color: theme.textSub }]}>Thèmes · 1000–1500 pts {isElite ? '(offerts avec Elite)' : ''}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hContent}>
          {THEMES.map(t => renderCosItem(t, 'theme'))}
        </ScrollView>

        {/* 3b — Icônes de profil (badges avatar & posts) */}
        <Text style={[s.subSection, { color: theme.textSub, marginTop: 14 }]}>Icônes · 150–200 pts {isElite ? '(offerts avec Elite)' : ''}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hContent}>
          {ICONS.map(i => renderCosItem(i, 'logo', ICON_PRICES))}
        </ScrollView>

        {/* 3c — Logos visuels (icône app + header) */}
        <Text style={[s.subSection, { color: theme.textSub, marginTop: 14 }]}>Logo App · 500–750 pts {isElite ? '(offerts avec Elite)' : ''}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hContent}>
          {LOGOS.map(l => renderCosItem(l, 'logo', LOGO_PRICES))}
        </ScrollView>

        <View style={{ height: 48 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles (layout ; couleurs via theme inline) ───────────────────────────────

const s = StyleSheet.create({
  bg:     { flex: 1 },
  scroll: { padding: 20, paddingTop: 12 },

  header:      { marginBottom: 12 },
  headerTitle: { fontSize: 26, fontWeight: '900' },
  headerSub:   { fontSize: 12, marginTop: 3 },

  freezeChip:     { alignSelf: 'flex-start', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 16 },
  freezeChipText: { fontSize: 13, fontWeight: '700' },

  statsCard: {
    borderRadius: 18, borderWidth: 1,
    flexDirection: 'row', padding: 16, marginBottom: 24, alignItems: 'center',
  },
  statCol: { flex: 1, alignItems: 'center' },
  statDiv: { width: 1, height: 34 },
  statVal: { fontSize: 15, fontWeight: '800', marginBottom: 2 },
  statLbl: { fontSize: 10 },

  sectionTitle: { fontSize: 17, fontWeight: '800', marginBottom: 2 },
  sectionSub:   { fontSize: 12, marginBottom: 14 },
  subSection:   { fontSize: 12, fontWeight: '600', marginBottom: 10, marginTop: 6 },

  // Plan abonnement
  planCard: {
    borderRadius: 20, borderWidth: 1, padding: 18, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  planBadge:     { position: 'absolute', top: -1, right: 18, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  planBadgeText: { fontSize: 9, fontWeight: '900', color: '#fff', letterSpacing: 1 },
  planHead:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  planIcon:      { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  planName:      { fontSize: 17, fontWeight: '800' },
  planPrice:     { fontSize: 20, fontWeight: '900', marginTop: 1 },
  planPer:       { fontSize: 12, fontWeight: '600' },
  planPerks:     { gap: 8, marginBottom: 16 },
  perkRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  perkText:      { fontSize: 13, flex: 1 },

  subBtn:    { borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  subText:   { color: '#fff', fontWeight: '800', fontSize: 15 },
  manageBtn: { borderRadius: 14, paddingVertical: 13, alignItems: 'center', borderWidth: 1.5 },
  manageText:{ fontWeight: '700', fontSize: 14 },
  renewText: { fontSize: 12, textAlign: 'center', marginBottom: 10 },

  // Pass points
  passRow:    { borderRadius: 16, borderWidth: 1, flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 10, gap: 12 },
  passName:   { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  passDesc:   { fontSize: 11, lineHeight: 15 },
  passBtn:    { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, minWidth: 78, alignItems: 'center' },
  passBtnTxt: { fontSize: 12, fontWeight: '800', color: '#fff' },

  // Cosmétiques
  hContent:    { gap: 10, paddingRight: 4, paddingBottom: 4 },
  cosCard:     { borderRadius: 16, borderWidth: 1, width: 120, padding: 14, alignItems: 'center', gap: 6 },
  cosEmoji:    { fontSize: 30 },
  cosImg:      { width: 72, height: 72, borderRadius: 10 },
  cosName:     { fontSize: 11, fontWeight: '700', textAlign: 'center' },
  cosPriceLbl: { fontSize: 10, fontWeight: '600', textAlign: 'center', marginTop: -2 },

  tag:        { borderRadius: 9, paddingHorizontal: 10, paddingVertical: 4 },
  tagText:    { fontSize: 10, fontWeight: '700' },
  tagTextLight:{ fontSize: 10, fontWeight: '800', color: '#fff' },
  equipBtn:   { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1.5 },
  equipText:  { fontSize: 10, fontWeight: '800' },
  buyBtn:     { borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  buyText:    { fontSize: 10, fontWeight: '800', color: '#fff' },
});
