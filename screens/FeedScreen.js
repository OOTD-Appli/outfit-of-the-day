import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  Image, TouchableOpacity, ActivityIndicator, Dimensions
} from 'react-native';
import { supabase } from '../lib/supabase';

const { width, height } = Dimensions.get('window');
const ITEM_HEIGHT = height;

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
      .select(`*, profiles(username, avatar_url), likes(id, user_id)`)
      .order('created_at', { ascending: false });

    if (!error) setOotds(data);
    setLoading(false);
  };

  const toggleLike = async (ootdId, isLiked, likeId) => {
    // Mise à jour locale immédiate — pas de rechargement !
    setOotds(prev => prev.map(item => {
      if (item.id !== ootdId) return item;
      if (isLiked) {
        return { ...item, likes: item.likes.filter(l => l.id !== likeId) };
      } else {
        return { ...item, likes: [...item.likes, { id: 'temp', user_id: userId }] };
      }
    }));

    // Mise à jour Supabase en arrière-plan
    if (isLiked) {
      await supabase.from('likes').delete().eq('id', likeId);
    } else {
      const { data } = await supabase
        .from('likes')
        .insert({ user_id: userId, ootd_id: ootdId })
        .select()
        .single();

      // Remplace l'id temporaire par le vrai
      if (data) {
        setOotds(prev => prev.map(item => {
          if (item.id !== ootdId) return item;
          return {
            ...item,
            likes: item.likes.map(l => l.id === 'temp' ? data : l)
          };
        }));
      }
    }
  };

  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'à l\'instant';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}j`;
  };

  const renderItem = ({ item }) => {
    const likeObj = item.likes?.find(l => l.user_id === userId);
    const isLiked = !!likeObj;
    const likesCount = item.likes?.length || 0;

    return (
      <View style={styles.post}>
        <Image
          source={{ uri: item.image_url }}
          style={styles.photo}
          resizeMode="cover"
        />

        <View style={styles.overlay}>
          <View style={styles.postHeader}>
            {item.profiles?.avatar_url ? (
              <Image source={{ uri: item.profiles.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>
                  {item.profiles?.username?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
            <View style={styles.userInfo}>
              <Text style={styles.username}>{item.profiles?.username || 'Anonyme'}</Text>
              <Text style={styles.timeAgo}>{timeAgo(item.created_at)}</Text>
            </View>
            <View style={styles.scorePill}>
              <Text style={styles.scorePillText}>⭐ {item.score_global}</Text>
            </View>
          </View>

          <Text style={styles.conseil} numberOfLines={2}>{item.conseil}</Text>

          <View style={styles.scores}>
            <View style={styles.scoreChip}>
              <Text style={styles.scoreChipText}>🎨 {item.score_couleurs}</Text>
            </View>
            <View style={styles.scoreChip}>
              <Text style={styles.scoreChipText}>✂️ {item.score_coupe}</Text>
            </View>
            <View style={styles.scoreChip}>
              <Text style={styles.scoreChipText}>🔥 {item.score_tendance}</Text>
            </View>
          </View>
        </View>

        <View style={styles.sideActions}>
          <TouchableOpacity
            style={styles.sideBtn}
            onPress={() => toggleLike(item.id, isLiked, likeObj?.id)}
          >
            <Text style={styles.sideBtnIcon}>{isLiked ? '❤️' : '🤍'}</Text>
            <Text style={styles.sideBtnCount}>{likesCount}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.sideBtn}>
            <Text style={styles.sideBtnIcon}>💬</Text>
            <Text style={styles.sideBtnCount}>0</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.sideBtn}>
            <Text style={styles.sideBtnIcon}>📤</Text>
          </TouchableOpacity>
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
    <View style={styles.container}>
      <FlatList
        data={ootds}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        pagingEnabled
        snapToInterval={ITEM_HEIGHT}
        snapToAlignment="start"
        decelerationRate="fast"
        getItemLayout={(_, index) => ({
          length: ITEM_HEIGHT,
          offset: ITEM_HEIGHT * index,
          index,
        })}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>👗</Text>
            <Text style={styles.emptyText}>Aucune tenue pour l'instant</Text>
            <Text style={styles.emptySub}>Sois le premier à poster !</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#000' },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },

  post:       { width, height: ITEM_HEIGHT, position: 'relative' },
  photo:      { width, height: ITEM_HEIGHT, position: 'absolute' },

  overlay:    {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: 90, paddingHorizontal: 16, paddingTop: 80,
  },

  postHeader:        { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 10 },
  avatar:            { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: '#fff' },
  avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ED93B1', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  avatarText:        { color: '#3a0d1e', fontWeight: '700', fontSize: 16 },
  userInfo:          { flex: 1 },
  username:          { color: '#fff', fontWeight: '700', fontSize: 14, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  timeAgo:           { color: 'rgba(255,255,255,0.7)', fontSize: 11 },
  scorePill:         { backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#ED93B1' },
  scorePillText:     { color: '#ED93B1', fontWeight: '700', fontSize: 12 },

  conseil:       { color: '#fff', fontSize: 13, marginBottom: 10, textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },

  scores:        { flexDirection: 'row', gap: 8 },
  scoreChip:     { backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  scoreChipText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  sideActions: { position: 'absolute', right: 12, bottom: 120, alignItems: 'center', gap: 20 },
  sideBtn:     { alignItems: 'center', gap: 4 },
  sideBtnIcon: { fontSize: 30 },
  sideBtnCount:{ color: '#fff', fontSize: 12, fontWeight: '600', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },

  empty:      { height, alignItems: 'center', justifyContent: 'center' },
  emptyIcon:  { fontSize: 52, marginBottom: 12 },
  emptyText:  { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptySub:   { color: '#555', fontSize: 13, marginTop: 6 },
});