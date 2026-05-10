import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, FlatList, Image, ActivityIndicator
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { useFocusEffect } from '@react-navigation/native';

export default function ProfilScreen() {
  const [profile, setProfile] = useState(null);
  const [ootds, setOotds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

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

      setProfile(profileData);
      setOotds(ootdsData || []);
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
      alert('Permission refusée !');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
      alert('Photo de profil mise à jour ! ✅');
    } catch (e) {
      alert('Erreur : ' + e.message);
    }
    setUploadingAvatar(false);
  };

  const moyenneScore = ootds.length > 0
    ? (ootds.reduce((acc, o) => acc + o.score_global, 0) / ootds.length).toFixed(1)
    : '-';

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator color="#ED93B1" size="large" />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={ootds}
        keyExtractor={item => item.id}
        numColumns={3}
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <Text style={styles.title}>Profil</Text>
              <TouchableOpacity onPress={handleLogout}>
                <Text style={styles.logout}>Déconnexion</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.profileCard}>
              {/* Avatar cliquable */}
              <TouchableOpacity onPress={changeAvatar} style={styles.avatarContainer}>
                {uploadingAvatar ? (
                  <View style={styles.avatar}>
                    <ActivityIndicator color="#3a0d1e" />
                  </View>
                ) : profile?.avatar_url ? (
                  <Image 
  source={{ uri: profile.avatar_url + '?t=' + new Date().getTime() }} 
  style={styles.avatarImg} 
/>
                ) : (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {profile?.username?.[0]?.toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
                <View style={styles.avatarEdit}>
                  <Text style={styles.avatarEditText}>📷</Text>
                </View>
              </TouchableOpacity>

              <Text style={styles.username}>{profile?.username || 'Anonyme'}</Text>

              <View style={styles.stats}>
                <View style={styles.statItem}>
                  <Text style={styles.statNum}>{ootds.length}</Text>
                  <Text style={styles.statLabel}>Tenues</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statNum}>{moyenneScore}</Text>
                  <Text style={styles.statLabel}>Score moyen</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statItem}>
                  <Text style={styles.statNum}>{profile?.points || 0}</Text>
                  <Text style={styles.statLabel}>Points</Text>
                </View>
              </View>
            </View>

            <View style={styles.niveauCard}>
              <Text style={styles.niveauLabel}>Niveau {profile?.niveau || 1}</Text>
              <View style={styles.niveauBar}>
                <View style={[styles.niveauFill, { width: `${((profile?.points || 0) % 100)}%` }]} />
              </View>
              <Text style={styles.niveauSub}>{profile?.points || 0} / 100 points pour le prochain niveau</Text>
            </View>

            <Text style={styles.galerieTitle}>Mes tenues</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Image source={{ uri: item.image_url }} style={styles.gridPhoto} />
        )}
        ListEmptyComponent={
          <View style={styles.emptyGalerie}>
            <Text style={styles.emptyText}>Aucune tenue pour l'instant</Text>
            <Text style={styles.emptySub}>Analyse ta première tenue !</Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0a0a0a' },
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 10 },
  title:          { fontSize: 24, fontWeight: '700', color: '#fff' },
  logout:         { color: '#555', fontSize: 13 },
  list:           { paddingBottom: 40 },

  profileCard:    { alignItems: 'center', padding: 20 },
  avatarContainer:{ position: 'relative', marginBottom: 12 },
  avatar:         { width: 80, height: 80, borderRadius: 40, backgroundColor: '#ED93B1', alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#ED93B1' },
  avatarText:     { color: '#3a0d1e', fontWeight: '800', fontSize: 32 },
  avatarEdit:     { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#0a0a0a', borderRadius: 12, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  avatarEditText: { fontSize: 14 },
  username:       { color: '#fff', fontWeight: '700', fontSize: 20, marginBottom: 20 },

  stats:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f0f0f', borderRadius: 16, padding: 16, width: '100%' },
  statItem:       { flex: 1, alignItems: 'center' },
  statNum:        { color: '#ED93B1', fontWeight: '800', fontSize: 22 },
  statLabel:      { color: '#555', fontSize: 11, marginTop: 2 },
  statDivider:    { width: 1, height: 30, backgroundColor: '#1a1a1a' },

  niveauCard:     { margin: 16, backgroundColor: '#0f0f0f', borderRadius: 16, padding: 16 },
  niveauLabel:    { color: '#fff', fontWeight: '700', fontSize: 15, marginBottom: 10 },
  niveauBar:      { height: 8, backgroundColor: '#1a1a1a', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  niveauFill:     { height: '100%', backgroundColor: '#ED93B1', borderRadius: 4 },
  niveauSub:      { color: '#555', fontSize: 11 },

  galerieTitle:   { color: '#fff', fontWeight: '700', fontSize: 16, padding: 16, paddingBottom: 8 },
  gridPhoto:      { width: '33.33%', aspectRatio: 1 },

  emptyGalerie:   { alignItems: 'center', padding: 40 },
  emptyText:      { color: '#fff', fontSize: 16, fontWeight: '600' },
  emptySub:       { color: '#555', fontSize: 13, marginTop: 6 },
});