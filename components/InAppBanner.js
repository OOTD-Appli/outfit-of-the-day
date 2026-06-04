import { useEffect, useRef, useState, useCallback } from 'react';
import { Animated, Text, StyleSheet, TouchableOpacity, View, Platform } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/themeContext';
import { getActiveChat } from '../lib/activeChat';

// Bannière flottante descendant du haut quand un message arrive sur un autre onglet.
// Aucun stockage : écoute Realtime sur messages.receiver_id = moi.
export default function InAppBanner({ userId, onPress }) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const [banner, setBanner] = useState(null); // { senderId, username, avatar_url, preview }
  const translateY = useRef(new Animated.Value(-160)).current;
  const hideTimer = useRef(null);

  const previewOf = (msg) => {
    if (msg.image_url) return '📸 Photo';
    if (typeof msg.content === 'string' && msg.content.startsWith('{"_type":"profile"')) return '👤 Profil partagé';
    return msg.content || 'Nouveau message';
  };

  const dismiss = useCallback(() => {
    Animated.timing(translateY, { toValue: -160, duration: 220, useNativeDriver: true }).start(() => setBanner(null));
  }, [translateY]);

  const show = useCallback((data) => {
    setBanner(data);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 7 }).start();
    hideTimer.current = setTimeout(() => dismiss(), 3200);
  }, [translateY, dismiss]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel('inapp-banner')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `receiver_id=eq.${userId}`,
      }, async (payload) => {
        const msg = payload.new;
        if (!msg || msg.sender_id === userId) return;
        // Déjà dans cette conversation → pas de bannière
        if (getActiveChat() === msg.sender_id) return;
        const { data: prof } = await supabase
          .from('profiles')
          .select('username, avatar_url')
          .eq('id', msg.sender_id)
          .single();
        show({
          senderId: msg.sender_id,
          username: prof?.username || 'Quelqu\'un',
          avatar_url: prof?.avatar_url || null,
          preview: previewOf(msg),
        });
      })
      .subscribe();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      supabase.removeChannel(channel);
    };
  }, [userId, show]);

  if (!banner) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        { top: Math.max(insets.top, 8), transform: [{ translateY }] },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        activeOpacity={0.92}
        style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border, shadowColor: theme.accent }]}
        onPress={() => { dismiss(); onPress?.(banner.senderId); }}
      >
        <View style={[styles.avatar, { backgroundColor: theme.accent + 'CC' }]}>
          {banner.avatar_url
            ? <ExpoImage source={{ uri: banner.avatar_url }} style={styles.avatarImg} contentFit="cover" />
            : <Text style={styles.avatarInitial}>{banner.username?.[0]?.toUpperCase() || '?'}</Text>}
        </View>
        <View style={styles.texts}>
          <Text style={[styles.name, { color: theme.textPri }]} numberOfLines={1}>{banner.username}</Text>
          <Text style={[styles.preview, { color: theme.textSub }]} numberOfLines={1}>{banner.preview}</Text>
        </View>
        <Text style={styles.bell}>💬</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 9999 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 18, borderWidth: 1, padding: 12,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 14,
    elevation: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : null),
  },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: 42, height: 42 },
  avatarInitial: { color: '#fff', fontWeight: '700', fontSize: 17 },
  texts: { flex: 1 },
  name: { fontWeight: '800', fontSize: 14 },
  preview: { fontSize: 12.5, marginTop: 1 },
  bell: { fontSize: 18 },
});
