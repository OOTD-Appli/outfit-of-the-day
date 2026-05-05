import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  Image, TouchableOpacity, SafeAreaView, ActivityIndicator
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function FeedScreen() {
  const [ootds, setOotds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    fetchFeed();
  }, []);

  const fetchFeed = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user?.id);

    const { data, error } = await supabase
      .from('ootds')
      .select(`
        *,
        profiles(username, avatar_url),
        likes(id, user_id)
      `)
      .order('created_at', { ascending: false });

    if (!error) setOotds(data);
    setLoading(false);
  };

  const toggleLike = async (ootdId, isLiked, likeId) => {
    if (isLiked) {
      await supabase.from('likes').delete().eq('id', likeId);
    } else {
      await supabase.from('likes').insert({ user_id: userId, ootd_id: ootdId });
    }
    fetchFeed();
  };

  const renderItem = ({ item }) => {
    const likeObj = item.likes?.find(l => l.user_id === userId);
    const isLiked = !!likeObj;
    const likesCount = item.likes?.length || 0;

    return (
      <View style={styles.card}>
        {/* Header */}
        <View style={styles.cardHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.profiles?.username?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
          <View>
            <Text style={styles.username}>{item.profiles?.username || 'Anonyme'}</Text>
            <Text style={styles.date}>
              {new Date(item.created_at).toLocaleDateString('fr-FR')}
            </Text>
          </View>
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreBadgeText}>{item.score_global}/10</Text>
          </View>
        </View>

        {/* Photo */}
        <Image source={{ uri: item.image_url }} style={styles.photo} />

        {/* Conseil */}
        {item.conseil && (
          <Text style={styles.conseil}>💬 {item.conseil}</Text>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.likeBtn}
            onPress={() => toggleLike(item.id, isLiked, likeObj?.id)}
          >
            <Text style={styles.likeIcon}>{isLiked ? '❤️' : '🤍'}</Text>
            <Text style={styles.likeCount}>{likesCount}</Text>
          </TouchableOpacity>

          <View style={styles.scores}>
            <Text style={styles.scoreItem}>🎨 {item.score_couleurs}</Text>
            <Text style={styles.scoreItem}>✂️ {item.score_coupe}</Text>
            <Text style={styles.scoreItem}>🔥 {item.score_tendance}</Text>
          </View>
        </View>
      </View>
    );
  };

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator color="#ED93B1" size="large" />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Feed</Text>
        <TouchableOpacity onPress={fetchFeed}>
          <Text style={styles.refresh}>↻</Text>
        </TouchableOpacity>
      </View>

      {ootds.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>👗</Text>
          <Text style={styles.emptyText}>Aucune tenue pour l'instant</Text>
          <Text style={styles.emptySub}>Sois le premier à poster !</Text>
        </View>
      ) : (
        <FlatList
          data={ootds}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#0a0a0a' },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 10 },
  title:      { fontSize: 24, fontWeight: '700', color: '#fff' },
  refresh:    { fontSize: 24, color: '#ED93B1' },
  list:       { padding: 16, gap: 16 },

  card:       { backgroundColor: '#0f0f0f', borderRadius: 16, overflow: 'hidden' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  avatar:     { width: 38, height: 38, borderRadius: 19, backgroundColor: '#ED93B1', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#3a0d1e', fontWeight: '700', fontSize: 16 },
  username:   { color: '#fff', fontWeight: '600', fontSize: 14 },
  date:       { color: '#555', fontSize: 11 },
  scoreBadge: { marginLeft: 'auto', backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  scoreBadgeText: { color: '#ED93B1', fontWeight: '700', fontSize: 13 },

  photo:   { width: '100%', height: 320 },
  conseil: { color: '#888', fontSize: 12, padding: 12, lineHeight: 18 },

  actions:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  likeBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  likeIcon:  { fontSize: 20 },
  likeCount: { color: '#fff', fontWeight: '600', fontSize: 14 },
  scores:    { flexDirection: 'row', gap: 12 },
  scoreItem: { color: '#555', fontSize: 13 },

  emptyIcon: { fontSize: 52, marginBottom: 12 },
  emptyText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptySub:  { color: '#555', fontSize: 13, marginTop: 6 },
});