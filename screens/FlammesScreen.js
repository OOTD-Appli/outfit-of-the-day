import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView,
  FlatList, Image, TouchableOpacity, ActivityIndicator,
  TextInput, Modal, ScrollView, Dimensions
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

const { width, height } = Dimensions.get('window');

/** Paires flammes en base : user1_id < user2_id (contrainte SQL). */
function flammeOrderedIds(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? { user1_id: x, user2_id: y } : { user1_id: y, user2_id: x };
}

export default function FlammesScreen() {
  const [view, setView] = useState('flammes'); // 'flammes' | 'chat' | 'search'
  const [flammes, setFlammes] = useState([]);
  const [snaps, setSnaps] = useState([]);
  const [friends, setFriends] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFriend, setSelectedFriend] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);
  const [username, setUsername] = useState('');
  const [sendingSnap, setSendingSnap] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    setUserId(user?.id);

    if (!user) {
      setLoading(false);
      return;
    }

    const { data: profileData } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();
    setUsername(profileData?.username || '');

    // Récupère les amis acceptés
    const { data: friendsData } = await supabase
      .from('friendships')
      .select('*, profiles!friendships_friend_id_fkey(id, username, avatar_url)')
      .eq('user_id', user.id)
      .eq('status', 'accepted');

    const { data: friendsData2 } = await supabase
      .from('friendships')
      .select('*, profiles!friendships_user_id_fkey(id, username, avatar_url)')
      .eq('friend_id', user.id)
      .eq('status', 'accepted');

    const allFriends = [
      ...(friendsData || []).map(f => ({ id: f.friend_id, ...f.profiles })),
      ...(friendsData2 || []).map(f => ({ id: f.user_id, ...f.profiles })),
    ];
    setFriends(allFriends);

    // Récupère les flammes
    const { data: flammesData } = await supabase
      .from('flammes')
      .select('*')
      .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`);
    setFlammes(flammesData || []);

    setLoading(false);
  };

  const searchUsers = async (query) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }

    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${query}%`)
      .neq('id', userId)
      .limit(10);

    setSearchResults(data || []);
  };

  const addFriend = async (friendId) => {
    await supabase.from('friendships').upsert({
      user_id: userId,
      friend_id: friendId,
      status: 'accepted',
    }, { onConflict: 'user_id,friend_id' });

    await supabase.from('friendships').upsert({
      user_id: friendId,
      friend_id: userId,
      status: 'accepted',
    }, { onConflict: 'user_id,friend_id' });

    await supabase.from('flammes').upsert({
      ...flammeOrderedIds(userId, friendId),
      streak: 0,
      last_snap_at: new Date().toISOString(),
    }, { onConflict: 'user1_id,user2_id', ignoreDuplicates: true });

    fetchData();
    alert('Ami ajouté ! 🎉');
  };

  const openChat = async (friend) => {
    setSelectedFriend(friend);
    setView('chat');

    const { data } = await supabase
      .from('snaps')
      .select('*')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${friend.id}),and(sender_id.eq.${friend.id},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: true });

    setSnaps(data || []);
  };

  const sendSnap = async () => {
    if (!selectedFriend) return;
    setSendingSnap(true);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setSendingSnap(false); return; }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled) { setSendingSnap(false); return; }

    try {
      const fileName = `snaps/${userId}/${Date.now()}.jpg`;
      const photoResponse = await fetch(result.assets[0].uri);
      const blob = await photoResponse.blob();

      await supabase.storage.from('ootds').upload(fileName, blob, { contentType: 'image/jpeg' });
      const { data: urlData } = supabase.storage.from('ootds').getPublicUrl(fileName);

      await supabase.from('snaps').insert({
        sender_id: userId,
        receiver_id: selectedFriend.id,
        image_url: urlData.publicUrl,
      });

      // Met à jour la flamme
      const flamme = flammes.find(f =>
        (f.user1_id === userId && f.user2_id === selectedFriend.id) ||
        (f.user1_id === selectedFriend.id && f.user2_id === userId)
      );

      if (flamme) {
        const lastSnap = new Date(flamme.last_snap_at);
        const now = new Date();
        const diffHours = (now - lastSnap) / 3600000;
        const newStreak = diffHours < 24 ? flamme.streak + 1 : 1;

        await supabase.from('flammes').update({
          streak: newStreak,
          last_snap_at: now.toISOString(),
        }).eq('id', flamme.id);
      }

      await openChat(selectedFriend);
      alert('Snap envoyé ! 🔥');
    } catch (e) {
      alert('Erreur : ' + e.message);
    }
    setSendingSnap(false);
  };

  const getStreak = (friendId) => {
    const flamme = flammes.find(f =>
      (f.user1_id === userId && f.user2_id === friendId) ||
      (f.user1_id === friendId && f.user2_id === userId)
    );
    return flamme?.streak || 0;
  };

  if (loading) return (
    <View style={styles.center}>
      <ActivityIndicator color="#ED93B1" size="large" />
    </View>
  );

  // Écran Chat
  if (view === 'chat' && selectedFriend) return (
    <SafeAreaView style={styles.container}>
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={() => setView('flammes')} style={styles.backBtn}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.chatHeaderInfo}>
          <View style={styles.chatAvatar}>
            <Text style={styles.chatAvatarText}>
              {selectedFriend.username?.[0]?.toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.chatUsername}>{selectedFriend.username}</Text>
            <Text style={styles.chatStreak}>🔥 {getStreak(selectedFriend.id)} jours</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.snapBtn} onPress={sendSnap} disabled={sendingSnap}>
          {sendingSnap
            ? <ActivityIndicator color="#3a0d1e" size="small" />
            : <Text style={styles.snapBtnText}>📸</Text>
          }
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.chatMessages} contentContainerStyle={styles.chatMessagesContent}>
        {snaps.length === 0 ? (
          <View style={styles.chatEmpty}>
            <Text style={styles.chatEmptyIcon}>🔥</Text>
            <Text style={styles.chatEmptyText}>Envoie ton premier snap !</Text>
            <Text style={styles.chatEmptySub}>Maintiens la flamme chaque jour</Text>
          </View>
        ) : (
          snaps.map(snap => (
            <View key={snap.id} style={[
              styles.snapBubble,
              snap.sender_id === userId ? styles.snapBubbleRight : styles.snapBubbleLeft
            ]}>
              <Image source={{ uri: snap.image_url }} style={styles.snapImage} />
              <Text style={styles.snapTime}>
                {new Date(snap.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );

  // Écran principal Flammes
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Flammes 🔥</Text>
        <TouchableOpacity
          style={styles.searchToggle}
          onPress={() => setView(view === 'search' ? 'flammes' : 'search')}
        >
          <Text style={styles.searchToggleText}>{view === 'search' ? '✕' : '🔍'}</Text>
        </TouchableOpacity>
      </View>

      {/* Recherche d'amis */}
      {view === 'search' && (
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Cherche un ami par pseudo..."
            placeholderTextColor="#555"
            value={searchQuery}
            onChangeText={searchUsers}
            autoFocus
          />
          <FlatList
            data={searchResults}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <View style={styles.searchResult}>
                <View style={styles.searchAvatar}>
                  <Text style={styles.searchAvatarText}>
                    {item.username?.[0]?.toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.searchUsername}>{item.username}</Text>
                <TouchableOpacity
                  style={styles.addBtn}
                  onPress={() => addFriend(item.id)}
                >
                  <Text style={styles.addBtnText}>+ Ajouter</Text>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              searchQuery.length >= 2 && (
                <Text style={styles.noResults}>Aucun utilisateur trouvé</Text>
              )
            }
          />
        </View>
      )}

      {/* Liste des amis et flammes */}
      {view === 'flammes' && (
        <FlatList
          data={friends}
          keyExtractor={item => item.id}
          ListHeaderComponent={
            <Text style={styles.sectionTitle}>Mes flammes</Text>
          }
          renderItem={({ item }) => {
            const streak = getStreak(item.id);
            return (
              <TouchableOpacity style={styles.friendCard} onPress={() => openChat(item)}>
                <View style={styles.friendAvatar}>
                  {item.avatar_url ? (
                    <Image source={{ uri: item.avatar_url }} style={styles.friendAvatarImg} />
                  ) : (
                    <Text style={styles.friendAvatarText}>
                      {item.username?.[0]?.toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={styles.friendInfo}>
                  <Text style={styles.friendUsername}>{item.username}</Text>
                  <Text style={styles.friendSub}>Appuie pour envoyer un snap</Text>
                </View>
                <View style={styles.streakBadge}>
                  <Text style={styles.streakEmoji}>🔥</Text>
                  <Text style={styles.streakCount}>{streak}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔥</Text>
              <Text style={styles.emptyText}>Aucun ami pour l'instant</Text>
              <Text style={styles.emptySub}>Cherche des amis avec 🔍</Text>
              <TouchableOpacity
                style={styles.findFriendsBtn}
                onPress={() => setView('search')}
              >
                <Text style={styles.findFriendsBtnText}>Trouver des amis</Text>
              </TouchableOpacity>
            </View>
          }
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0a0a0a' },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list:         { paddingBottom: 40 },

  header:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 12 },
  title:            { fontSize: 24, fontWeight: '800', color: '#fff' },
  searchToggle:     { backgroundColor: '#1a1a1a', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  searchToggleText: { fontSize: 18 },

  sectionTitle: { color: '#fff', fontWeight: '700', fontSize: 16, paddingHorizontal: 16, marginBottom: 12 },

  searchContainer: { flex: 1, paddingHorizontal: 16 },
  searchInput:     { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14, color: '#fff', fontSize: 15, marginBottom: 16, borderWidth: 1, borderColor: '#2a2a2a' },
  searchResult:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a', gap: 12 },
  searchAvatar:    { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ED93B1', alignItems: 'center', justifyContent: 'center' },
  searchAvatarText:{ color: '#3a0d1e', fontWeight: '700', fontSize: 18 },
  searchUsername:  { color: '#fff', fontWeight: '600', fontSize: 15, flex: 1 },
  addBtn:          { backgroundColor: '#ED93B1', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 },
  addBtnText:      { color: '#3a0d1e', fontWeight: '700', fontSize: 13 },
  noResults:       { color: '#555', textAlign: 'center', marginTop: 20 },

  friendCard:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a', gap: 12 },
  friendAvatar:     { width: 52, height: 52, borderRadius: 26, backgroundColor: '#ED93B1', alignItems: 'center', justifyContent: 'center' },
  friendAvatarImg:  { width: 52, height: 52, borderRadius: 26 },
  friendAvatarText: { color: '#3a0d1e', fontWeight: '700', fontSize: 20 },
  friendInfo:       { flex: 1 },
  friendUsername:   { color: '#fff', fontWeight: '600', fontSize: 15 },
  friendSub:        { color: '#555', fontSize: 12, marginTop: 2 },
  streakBadge:      { alignItems: 'center' },
  streakEmoji:      { fontSize: 22 },
  streakCount:      { color: '#ED93B1', fontWeight: '800', fontSize: 16 },

  empty:            { alignItems: 'center', padding: 60 },
  emptyIcon:        { fontSize: 52, marginBottom: 12 },
  emptyText:        { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptySub:         { color: '#555', fontSize: 13, marginTop: 6, marginBottom: 20 },
  findFriendsBtn:   { backgroundColor: '#ED93B1', borderRadius: 20, paddingHorizontal: 24, paddingVertical: 12 },
  findFriendsBtnText: { color: '#3a0d1e', fontWeight: '700', fontSize: 15 },

  chatHeader:      { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 0.5, borderBottomColor: '#1a1a1a', gap: 12 },
  backBtn:         { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText:        { color: '#fff', fontSize: 22, fontWeight: '300' },
  chatHeaderInfo:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatAvatar:      { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ED93B1', alignItems: 'center', justifyContent: 'center' },
  chatAvatarText:  { color: '#3a0d1e', fontWeight: '700', fontSize: 16 },
  chatUsername:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  chatStreak:      { color: '#ED93B1', fontSize: 12, fontWeight: '600' },
  snapBtn:         { backgroundColor: '#ED93B1', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  snapBtnText:     { fontSize: 20 },

  chatMessages:        { flex: 1 },
  chatMessagesContent: { padding: 16, gap: 12 },
  chatEmpty:           { alignItems: 'center', paddingTop: 60 },
  chatEmptyIcon:       { fontSize: 52, marginBottom: 12 },
  chatEmptyText:       { color: '#fff', fontSize: 18, fontWeight: '600' },
  chatEmptySub:        { color: '#555', fontSize: 13, marginTop: 6 },

  snapBubble:      { maxWidth: '70%', gap: 4 },
  snapBubbleRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  snapBubbleLeft:  { alignSelf: 'flex-start', alignItems: 'flex-start' },
  snapImage:       { width: 200, height: 200, borderRadius: 16 },
  snapTime:        { color: '#555', fontSize: 10 },
});