import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, FlatList, Image, ActivityIndicator
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function ProfilScreen() {
  const [profile, setProfile] = useState(null);
  const [ootds, setOotds] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProfil();
  }, []);

  const fetchProfil = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    const { data: profileData, error: profileError } = await supabase
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
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
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
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>Profil</Text>
              <TouchableOpacity onPress={handleLogout}>
                <Text style={styles.logout}>Déconnexion</Text>
              </TouchableOpacity>
            </View>

            {/* Infos profil */}
            <View style={styles.profileCard}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {profile?.username?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
              <Text style={styles.username}>{profile?.username || 'Anonyme'}</Text>

              {/* Stats */}
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

            {/* Niveau */}
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
  container:    { flex: 1, backgroundColor: '#0a0a0a' },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 10 },
  title:        { fontSize: 24, fontWeight: '700', color: '#fff' },
  logout:       { color: '#555', fontSize: 13 },
  list:         { paddingBottom: 40 },

  profileCard:  { alignItems: 'center', padding: 20 },
  avatar:       { width: 80, height: 80, borderRadius: 40, backgroundColor: '#ED93B1', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText:   { color: '#3a0d1e', fontWeight: '800', fontSize: 32 },
  username:     { color: '#fff', fontWeight: '700', fontSize: 20, marginBottom: 20 },

  stats:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f0f0f', borderRadius: 16, padding: 16, width: '100%' },
  statItem:     { flex: 1, alignItems: 'center' },
  statNum:      { color: '#ED93B1', fontWeight: '800', fontSize: 22 },
  statLabel:    { color: '#555', fontSize: 11, marginTop: 2 },
  statDivider:  { width: 1, height: 30, backgroundColor: '#1a1a1a' },

  niveauCard:   { margin: 16, backgroundColor: '#0f0f0f', borderRadius: 16, padding: 16 },
  niveauLabel:  { color: '#fff', fontWeight: '700', fontSize: 15, marginBottom: 10 },
  niveauBar:    { height: 8, backgroundColor: '#1a1a1a', borderRadius: 4, overflow: 'hidden', marginBottom: 6 },
  niveauFill:   { height: '100%', backgroundColor: '#ED93B1', borderRadius: 4 },
  niveauSub:    { color: '#555', fontSize: 11 },

  galerieTitle: { color: '#fff', fontWeight: '700', fontSize: 16, padding: 16, paddingBottom: 8 },
  gridPhoto:    { width: '33.33%', aspectRatio: 1 },

  emptyGalerie: { alignItems: 'center', padding: 40 },
  emptyText:    { color: '#fff', fontSize: 16, fontWeight: '600' },
  emptySub:     { color: '#555', fontSize: 13, marginTop: 6 },
});