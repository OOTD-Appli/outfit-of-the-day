import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/themeContext';
import { timeAgo } from '../lib/utils';

export default function FeedCommentsModal({
  visible,
  ootdId,
  userId,
  onClose,
  onThreadCount,
}) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');

  const load = useCallback(async () => {
    if (!ootdId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('comments')
      .select('id, body, created_at, user_id, profiles(username, avatar_url)')
      .eq('ootd_id', ootdId)
      .order('created_at', { ascending: true });
    setLoading(false);
    if (error) {
      Alert.alert('Commentaires', error.message);
      setRows([]);
      return;
    }
    const list = data ?? [];
    setRows(list);
    onThreadCount?.(ootdId, list.length);
  }, [ootdId, onThreadCount]);

  useEffect(() => {
    if (visible && ootdId) {
      setDraft('');
      load();
    } else if (!visible) {
      setRows([]);
    }
  }, [visible, ootdId, load]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !ootdId || !userId) return;
    setSending(true);
    const { data, error } = await supabase
      .from('comments')
      .insert({ ootd_id: ootdId, user_id: userId, body: text })
      .select('id, body, created_at, user_id, profiles(username, avatar_url)')
      .single();
    setSending(false);
    if (error) {
      Alert.alert('Envoi impossible', error.message);
      return;
    }
    setDraft('');
    setRows((prev) => {
      const next = [...prev, data];
      onThreadCount?.(ootdId, next.length);
      return next;
    });
  };

  const remove = (comment) => {
    if (comment.user_id !== userId) return;
    Alert.alert(
      'Supprimer',
      'Retirer ce commentaire ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('comments')
              .delete()
              .eq('id', comment.id);
            if (error) {
              Alert.alert('Erreur', error.message);
              return;
            }
            setRows((prev) => {
              const next = prev.filter((r) => r.id !== comment.id);
              onThreadCount?.(ootdId, next.length);
              return next;
            });
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible && !!ootdId}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: theme.bg }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.bg, paddingTop: Math.max(insets.top, 12), paddingBottom: insets.bottom + 8 },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Text style={[styles.title, { color: theme.textPri }]}>Commentaires</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={[styles.close, { color: theme.accent }]}>Fermer</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loader}>
              <ActivityIndicator color={theme.accent} size="large" />
            </View>
          ) : (
            <FlatList
              style={styles.listFlex}
              data={rows}
              keyExtractor={(item) => item.id}
              contentContainerStyle={rows.length ? styles.list : styles.listEmpty}
              ListEmptyComponent={
                <Text style={[styles.emptyLabel, { color: theme.textSub }]}>Aucun commentaire pour ce look.</Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  onLongPress={() => remove(item)}
                  style={[styles.row, { borderBottomColor: theme.border }]}
                >
                  <View style={styles.rowTop}>
                    <Text style={[styles.author, { color: theme.accent }]}>
                      {item.profiles?.username || 'Utilisateur'}
                    </Text>
                    <Text style={[styles.meta, { color: theme.textSub }]}>{timeAgo(item.created_at)}</Text>
                    {item.user_id === userId ? (
                      <TouchableOpacity onPress={() => remove(item)} hitSlop={8}>
                        <Text style={styles.trash}>Supprimer</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <Text style={[styles.body, { color: theme.textPri }]}>{item.body}</Text>
                </Pressable>
              )}
            />
          )}

          <View style={[styles.composer, { backgroundColor: theme.card, borderTopColor: theme.border }]}>
            <TextInput
              style={[styles.input, { backgroundColor: theme.bg, color: theme.textPri }]}
              placeholder="Ajouter un commentaire…"
              placeholderTextColor={theme.textSub}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={1000}
              editable={!!userId && !sending}
            />
            <TouchableOpacity
              style={[styles.send, { backgroundColor: theme.accent }, (!draft.trim() || sending || !userId) && styles.sendDisabled]}
              onPress={send}
              disabled={!draft.trim() || sending || !userId}
            >
              {sending ? (
                <ActivityIndicator color="#1a0a10" size="small" />
              ) : (
                <Text style={styles.sendLabel}>Envoyer</Text>
              )}
            </TouchableOpacity>
          </View>
          {!userId ? (
            <Text style={[styles.hint, { color: theme.textSub }]}>Connecte-toi pour commenter.</Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex:   { flex: 1 },
  sheet:  { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title:  { fontSize: 18, fontWeight: '700' },
  close:  { fontSize: 16, fontWeight: '600' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listFlex:  { flex: 1 },
  list:      { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, flexGrow: 1 },
  listEmpty: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  emptyLabel:{ textAlign: 'center', fontSize: 14 },
  row: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  author: { fontWeight: '700', fontSize: 13, flex: 1 },
  meta:   { fontSize: 11 },
  trash:  { color: '#ff6b6b', fontSize: 12, fontWeight: '600' },
  body:   { fontSize: 15, lineHeight: 21 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  send: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.45 },
  sendLabel: { color: '#1a0a10', fontWeight: '800', fontSize: 14 },
  hint: { fontSize: 12, textAlign: 'center', paddingTop: 6 },
});
