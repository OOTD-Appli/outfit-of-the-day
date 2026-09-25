import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Animated,
  PanResponder,
  useWindowDimensions,
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
  const { height: screenH } = useWindowDimensions();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');

  // Poignée de la modale : redimensionnable en glissant vers le haut/bas,
  // et fermeture complète si on tire suffisamment loin (ou vite) vers le bas.
  const DEFAULT_H = Math.round(screenH * 0.55);
  const MIN_H = Math.round(screenH * 0.3);
  const MAX_H = Math.round(screenH * 0.92);
  const sheetHeight = useRef(new Animated.Value(DEFAULT_H)).current;
  const currentHeightRef = useRef(DEFAULT_H);
  const dragStartHeightRef = useRef(DEFAULT_H);
  // Ce composant n'est jamais démonté par le parent (seul `visible` bascule),
  // donc handlePanResponder ci-dessous — un useRef(PanResponder.create(...)).current
  // — fige ses callbacks au tout premier rendu pour toujours. MIN_H/MAX_H sont
  // recalculés à chaque rendu depuis screenH : les lire en direct dans ces
  // callbacks les figerait aussi (même piège que todaysPhotos/width dans
  // CompetitionScreen.js, déjà rencontré et corrigé cette session) — on passe
  // donc par des refs tenues à jour à chaque rendu.
  const minHRef = useRef(MIN_H);
  const maxHRef = useRef(MAX_H);
  useEffect(() => { minHRef.current = MIN_H; maxHRef.current = MAX_H; }, [MIN_H, MAX_H]);

  const handlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        dragStartHeightRef.current = currentHeightRef.current;
      },
      onPanResponderMove: (_, g) => {
        // Glisser vers le haut (dy négatif) agrandit la modale, vers le bas la réduit.
        const next = Math.max(0, Math.min(maxHRef.current, dragStartHeightRef.current - g.dy));
        sheetHeight.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const proposed = dragStartHeightRef.current - g.dy;
        const shouldDismiss = proposed < minHRef.current * 0.55 || (g.dy > 60 && g.vy > 0.9);
        if (shouldDismiss) {
          onClose();
          return;
        }
        const clamped = Math.min(maxHRef.current, Math.max(minHRef.current, proposed));
        currentHeightRef.current = clamped;
        Animated.spring(sheetHeight, { toValue: clamped, useNativeDriver: false, bounciness: 4 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(sheetHeight, { toValue: currentHeightRef.current, useNativeDriver: false, bounciness: 4 }).start();
      },
    })
  ).current;

  const load = useCallback(async () => {
    if (!ootdId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('comments')
      .select('id, body, created_at, user_id, profiles(username, avatar_url)')
      .eq('ootd_id', ootdId)
      .order('created_at', { ascending: true });
    setLoading(false);
    if (error) { Alert.alert('Commentaires', error.message); setRows([]); return; }
    const list = data ?? [];
    setRows(list);
    onThreadCount?.(ootdId, list.length);
  }, [ootdId, onThreadCount]);

  useEffect(() => {
    if (visible && ootdId) {
      setDraft('');
      load();
      currentHeightRef.current = DEFAULT_H;
      sheetHeight.setValue(DEFAULT_H);
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
    if (error) { Alert.alert('Envoi impossible', error.message); return; }
    setDraft('');
    setRows((prev) => {
      const next = [...prev, data];
      onThreadCount?.(ootdId, next.length);
      return next;
    });
  };

  const remove = (comment) => {
    if (comment.user_id !== userId) return;
    Alert.alert('Supprimer', 'Retirer ce commentaire ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('comments').delete().eq('id', comment.id);
          if (error) { Alert.alert('Erreur', error.message); return; }
          setRows((prev) => {
            const next = prev.filter((r) => r.id !== comment.id);
            onThreadCount?.(ootdId, next.length);
            return next;
          });
        },
      },
    ]);
  };

  return (
    <Modal
      visible={visible && !!ootdId}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Zone supérieure semi-transparente — tap pour fermer */}
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

        {/* Bottom sheet + évitement clavier */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <Animated.View style={[styles.sheet, { backgroundColor: theme.bg, height: sheetHeight, paddingBottom: insets.bottom + 8 }]}>

            {/* Handle + header — la poignée seule porte le geste de
                redimensionnement/fermeture, pas toute la ligne (pour ne pas
                gêner le tap sur "Fermer"). */}
            <View style={[styles.handleWrap, { borderBottomColor: theme.border }]}>
              <View style={styles.handleGrip} {...handlePanResponder.panHandlers}>
                <View style={[styles.handle, { backgroundColor: theme.textSub }]} />
              </View>
              <View style={styles.header}>
                <Text style={[styles.title, { color: theme.textPri }]}>Commentaires</Text>
                <TouchableOpacity onPress={onClose} hitSlop={12}>
                  <Text style={[styles.close, { color: theme.accent }]}>Fermer</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Liste */}
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
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <Text style={[styles.emptyLabel, { color: theme.textSub }]}>Aucun commentaire pour ce look.</Text>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
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
                  </TouchableOpacity>
                )}
              />
            )}

            {/* Saisie */}
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
                {sending ? <ActivityIndicator color="#1a0a10" size="small" /> : <Text style={styles.sendLabel}>Envoyer</Text>}
              </TouchableOpacity>
            </View>
            {!userId && <Text style={[styles.hint, { color: theme.textSub }]}>Connecte-toi pour commenter.</Text>}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, justifyContent: 'flex-end' },
  backdrop:    { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  handleWrap:  { paddingBottom: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  // Zone de préhension plus grande que la barre visible (44px de haut) : porte
  // le geste de redimensionnement/fermeture, la barre elle-même reste fine.
  handleGrip:  { alignSelf: 'stretch', alignItems: 'center', paddingTop: 10, paddingBottom: 10 },
  handle:      { width: 44, height: 5, borderRadius: 3 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title:  { fontSize: 17, fontWeight: '700' },
  close:  { fontSize: 15, fontWeight: '600' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listFlex:  { flex: 1 },
  list:      { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, flexGrow: 1 },
  listEmpty: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  emptyLabel:{ textAlign: 'center', fontSize: 14 },
  row:       { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTop:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  author:    { fontWeight: '700', fontSize: 13, flex: 1 },
  meta:      { fontSize: 11 },
  trash:     { color: '#ff6b6b', fontSize: 12, fontWeight: '600' },
  body:      { fontSize: 15, lineHeight: 21 },
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
  send:         { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, minWidth: 88, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.45 },
  sendLabel:    { color: '#1a0a10', fontWeight: '800', fontSize: 14 },
  hint:         { fontSize: 12, textAlign: 'center', paddingTop: 6 },
});
