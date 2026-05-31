import { useState, useCallback, useEffect } from 'react';
import { computeLevelInfo } from '../lib/utils';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Image, ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { useFocusEffect } from '@react-navigation/native';
import { useToast } from '../lib/toastContext';
import { useTheme } from '../lib/themeContext';
import { getLogoConfig } from '../lib/logoConfig';

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

  useEffect(() => {
    setAvatarLoadError(false);
  }, [profile]);

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
              <TouchableOpacity onPress={handleLogout}>
                <Text style={[styles.logout, { color: theme.accent }]}>Déconnexion</Text>
              </TouchableOpacity>
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
        renderItem={({ item }) => (
          <Image source={{ uri: item.image_url }} style={styles.gridPhoto} />
        )}
        ListEmptyComponent={
          <View style={styles.emptyGalerie}>
            <Text style={[styles.emptyText, { color: theme.textPri }]}>Aucune tenue pour l'instant</Text>
            <Text style={[styles.emptySub, { color: theme.textSub }]}>Analyse ta première tenue !</Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
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
  gridPhoto:      { width: '33.33%', aspectRatio: 1 },

  emptyGalerie:   { alignItems: 'center', padding: 40 },
  emptyText:      { fontSize: 16, fontWeight: '600' },
  emptySub:       { fontSize: 13, marginTop: 6 },
});
