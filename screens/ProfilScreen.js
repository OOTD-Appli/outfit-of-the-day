import { useState, useCallback, useEffect } from 'react';
import { computeLevelInfo } from '../lib/utils';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Image, ActivityIndicator,
  useWindowDimensions, Modal, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { useFocusEffect } from '@react-navigation/native';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';
import { getLogoConfig } from '../lib/logoConfig';
import { canInstallPwa, promptInstall } from '../lib/pwa';

export default function ProfilScreen() {
  const [profile, setProfile] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [ootds, setOotds] = useState([]);
  const [loading, setLoading] = useState(true);
  const { width: ww } = useWindowDimensions();
  const avatarSize = Math.min(Math.round(ww * 0.22), 90);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarLoadError, setAvatarLoadError] = useState(false);
  const { showToast } = useToast();
  const { theme } = useTheme();
  const [lightbox, setLightbox] = useState({ visible: false, index: 0 });
  const [installable, setInstallable] = useState(false);

  useEffect(() => {
    setAvatarLoadError(false);
  }, [profile]);

  // Bouton « Télécharger l'app » : visible seulement si installable (web, non installé)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const update = () => setInstallable(canInstallPwa());
    update();
    window.addEventListener('ootd-pwa-change', update);
    return () => window.removeEventListener('ootd-pwa-change', update);
  }, []);

  const fetchProfil = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProfile(null);
        setOotds([]);
        return;
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      const { data: ootdsData } = await supabase
        .from('ootds')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      const { data: subData } = await supabase
        .from('subscriptions')
        .select('status, plan_type')
        .eq('user_id', user.id)
        .maybeSingle();

      setProfile(profileData);
      setOotds(ootdsData || []);
      setSubscription(subData);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchProfil();
    }, [fetchProfil])
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleInstall = async () => {
    const ok = await promptInstall();
    if (ok) setInstallable(false);
  };

  const openLightbox = (index) => setLightbox({ visible: true, index });
  const closeLightbox = () => setLightbox({ visible: false, index: 0 });

  // Supprime l'outfit : ligne `ootds` (→ disparaît du feed et du profil) + fichier Storage
  const deleteOotd = (item) => {
    Alert.alert(
      'Supprimer',
      'Voulez-vous vraiment supprimer cet outfit ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('ootds').delete().eq('id', item.id);
              if (error) throw error;
              // Nettoyage du fichier image dans le Storage (best-effort)
              try {
                const marker = '/storage/v1/object/public/';
                const idx = (item.image_url || '').indexOf(marker);
                if (idx !== -1) {
                  const rest = item.image_url.slice(idx + marker.length);
                  const bucket = rest.split('/')[0];
                  const path = rest.split('/').slice(1).join('/');
                  if (bucket && path) await supabase.storage.from(bucket).remove([decodeURIComponent(path)]);
                }
              } catch (_) {}
              setOotds((prev) => prev.filter((o) => o.id !== item.id));
              closeLightbox();
              showToast('Outfit supprimé', { type: 'success' });
            } catch (e) {
              showToast(e.message || 'Suppression impossible', { type: 'error' });
            }
          },
        },
      ],
    );
  };

  const changeAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast('Permission refusée pour accéder à la galerie', { type: 'warning' });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled) return;

    setUploadingAvatar(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const fileName = `${user.id}/avatar.jpg`;

      const photoResponse = await fetch(result.assets[0].uri);
      const blob = await photoResponse.blob();

      await supabase.storage
        .from('avatars')
        .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });

      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      await supabase
        .from('profiles')
        .update({ avatar_url: urlData.publicUrl })
        .eq('id', user.id);

      await fetchProfil();
      showToast('Photo de profil mise à jour !', { type: 'success' });
    } catch (e) {
      showToast('Erreur : ' + e.message, { type: 'error' });
    }
    setUploadingAvatar(false);
  };

  const moyenneScore = ootds.length > 0
    ? (ootds.reduce((acc, o) => acc + o.score_global, 0) / ootds.length).toFixed(1)
    : '-';

  const levelInfo = computeLevelInfo(profile?.points || 0);
  const logoConfig = getLogoConfig(profile?.active_logo);
  const subActive = subscription && ['active', 'trialing'].includes(subscription.status);
  const premiumLabel = subActive
    ? (subscription.plan_type === 'elite' ? '💎 Elite' : '⭐ Plus')
    : null;

  if (loading) return (
    <View style={[styles.center, { backgroundColor: theme.bg }]}>
      <ActivityIndicator color={theme.accent} size="large" />
    </View>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]} edges={['top']}>
      <FlatList
        data={ootds}
        keyExtractor={item => item.id}
        numColumns={3}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <Text style={[styles.title, { color: theme.textPri }]}>Profil</Text>
              <View style={styles.headerActions}>
                {installable && (
                  <TouchableOpacity
                    style={[styles.installBtn, { backgroundColor: theme.accent }]}
                    onPress={handleInstall}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="download-outline" size={15} color="#fff" />
                    <Text style={styles.installBtnText}>Télécharger l'app</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.logoutBtn, { borderColor: theme.accent, backgroundColor: theme.accent + '14' }]}
                  onPress={handleLogout}
                  activeOpacity={0.85}
                >
                  <Ionicons name="log-out-outline" size={16} color={theme.accent} />
                  <Text style={[styles.logoutText, { color: theme.accent }]}>Déconnexion</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.profileCard}>
              <TouchableOpacity onPress={changeAvatar} style={styles.avatarContainer}>
                {uploadingAvatar ? (
                  <View style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: theme.accent, borderWidth: logoConfig.frameBorderColor ? 3 : 0, borderColor: logoConfig.frameBorderColor || 'transparent' }]}>
                    <ActivityIndicator color="#3a0d1e" />
                  </View>
                ) : profile?.avatar_url && !avatarLoadError ? (
                  <Image
                    source={{ uri: profile.avatar_url + '?t=' + new Date().getTime() }}
                    style={[styles.avatarImg, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: theme.accent, borderWidth: logoConfig.frameBorderColor ? 3 : 0, borderColor: logoConfig.frameBorderColor || 'transparent' }]}
                    onError={() => setAvatarLoadError(true)}
                  />
                ) : (
                  <View style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: theme.accent, borderWidth: logoConfig.frameBorderColor ? 3 : 0, borderColor: logoConfig.frameBorderColor || 'transparent' }]}>
                    <Text style={[styles.avatarText, { fontSize: Math.round(avatarSize * 0.38) }]}>
                      {profile?.username?.[0]?.toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
                <View style={[styles.avatarEdit, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                  <Text style={styles.avatarEditText}>📷</Text>
                </View>
              </TouchableOpacity>

              <View style={styles.usernameRow}>
                <Text style={[styles.username, { color: theme.textPri }]}>{profile?.username || 'Anonyme'}</Text>
                {logoConfig.badge && <Text style={styles.usernameBadge}>{logoConfig.badge}</Text>}
              </View>
              {premiumLabel && (
                <View style={[styles.premiumBadge, { backgroundColor: theme.accent + '1A', borderColor: theme.accent }]}>
                  <Text style={[styles.premiumBadgeText, { color: theme.accent }]}>{premiumLabel}</Text>
                </View>
              )}

              <View style={[styles.stats, { backgroundColor: theme.card }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: theme.accent }]}>{ootds.length}</Text>
                  <Text style={[styles.statLabel, { color: theme.textSub }]}>Tenues</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: theme.accent }]}>{moyenneScore}</Text>
                  <Text style={[styles.statLabel, { color: theme.textSub }]}>Score moyen</Text>
                </View>
                <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
                <View style={styles.statItem}>
                  <Text style={[styles.statNum, { color: theme.accent }]}>{profile?.points || 0}</Text>
                  <Text style={[styles.statLabel, { color: theme.textSub }]}>Points</Text>
                </View>
              </View>
            </View>

            <View style={[styles.niveauCard, { backgroundColor: theme.card }]}>
              <Text style={[styles.niveauLabel, { color: theme.textPri }]}>Niveau {profile?.niveau || 1}</Text>
              <View style={[styles.niveauBar, { backgroundColor: theme.border }]}>
                <View style={[styles.niveauFill, { width: `${levelInfo.percent}%`, backgroundColor: theme.accent }]} />
              </View>
              <Text style={[styles.niveauSub, { color: theme.textSub }]}>{levelInfo.progressInLevel} / {levelInfo.threshold} points pour le prochain niveau</Text>
            </View>

            <Text style={[styles.galerieTitle, { color: theme.textPri }]}>Mes tenues</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity style={styles.gridCell} activeOpacity={0.85} onPress={() => openLightbox(index)}>
            <Image source={{ uri: item.image_url }} style={styles.gridPhoto} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyGalerie}>
            <Text style={[styles.emptyText, { color: theme.textPri }]}>Aucune tenue pour l'instant</Text>
            <Text style={[styles.emptySub, { color: theme.textSub }]}>Analyse ta première tenue !</Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />

      {/* Lightbox plein écran : défilement horizontal page par page */}
      <Modal visible={lightbox.visible} animationType="fade" onRequestClose={closeLightbox} statusBarTranslucent>
        <View style={styles.lbContainer}>
          <FlatList
            data={ootds}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            keyExtractor={(item) => item.id}
            initialScrollIndex={lightbox.index}
            getItemLayout={(_, i) => ({ length: ww, offset: ww * i, index: i })}
            onMomentumScrollEnd={(e) =>
              setLightbox((prev) => ({ ...prev, index: Math.round(e.nativeEvent.contentOffset.x / ww) }))
            }
            renderItem={({ item }) => (
              <View style={[styles.lbPage, { width: ww }]}>
                <Image source={{ uri: item.image_url }} style={styles.lbImage} resizeMode="contain" />
              </View>
            )}
          />
          <SafeAreaView style={styles.lbBar} edges={['top']} pointerEvents="box-none">
            <TouchableOpacity style={styles.lbBtn} onPress={closeLightbox} activeOpacity={0.8}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.lbBtn}
              onPress={() => ootds[lightbox.index] && deleteOotd(ootds[lightbox.index])}
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={24} color="#fff" />
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1 },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 10 },
  title:          { fontSize: 24, fontWeight: '700' },
  logout:         { fontSize: 13 },
  list:           { paddingBottom: 40 },

  headerActions:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  installBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10 },
  installBtnText: { color: '#fff', fontWeight: '800', fontSize: 11.5 },
  logoutBtn:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, borderWidth: 1.5 },
  logoutText:     { fontWeight: '800', fontSize: 11.5 },

  lbContainer:    { flex: 1, backgroundColor: '#000' },
  lbPage:         { height: '100%', alignItems: 'center', justifyContent: 'center' },
  lbImage:        { width: '100%', height: '100%' },
  lbBar:          { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 6 },
  lbBtn:          { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', marginTop: 8 },

  profileCard:    { alignItems: 'center', padding: 20 },
  avatarContainer:{ position: 'relative', marginBottom: 12 },
  avatar:         { alignItems: 'center', justifyContent: 'center' },
  avatarImg:      {},
  avatarText:     { color: '#3a0d1e', fontWeight: '800' },
  avatarEdit:     { position: 'absolute', bottom: 0, right: 0, borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  avatarEditText: { fontSize: 14 },
  username:       { fontWeight: '700', fontSize: 20 },
  usernameRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  usernameBadge:  { fontSize: 18 },
  premiumBadge:   { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, borderWidth: 1, marginTop: -12, marginBottom: 14 },
  premiumBadgeText: { fontSize: 12, fontWeight: '800' },

  stats:          { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 16, width: '100%' },
  statItem:       { flex: 1, alignItems: 'center' },
  statNum:        { fontWeight: '800', fontSize: 22 },
  statLabel:      { fontSize: 11, marginTop: 2 },
  statDivider:    { width: 1, height: 30 },

  niveauCard:     { margin: 16, borderRadius: 16, padding: 16 },
  niveauLabel:    { fontWeight: '700', fontSize: 15, marginBottom: 10 },
  niveauBar:      { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  niveauFill:     { height: '100%', borderRadius: 4 },
  niveauSub:      { fontSize: 11 },

  galerieTitle:   { fontWeight: '700', fontSize: 16, padding: 16, paddingBottom: 8 },
  gridCell:       { width: '33.33%', aspectRatio: 1 },
  gridPhoto:      { width: '100%', height: '100%' },

  emptyGalerie:   { alignItems: 'center', padding: 40 },
  emptyText:      { fontSize: 16, fontWeight: '600' },
  emptySub:       { fontSize: 13, marginTop: 6 },
});
