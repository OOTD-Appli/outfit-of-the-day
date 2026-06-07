import {
  View, Text, StyleSheet, Modal, ScrollView, TextInput, Image,
  TouchableOpacity, ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Bouncy from '../components/Bouncy';

// Écran de personnalisation post-analyse (modal plein écran).
// Présentational : reçoit l'état + les 3 actions depuis AccueilScreen.
export default function CustomizationScreen({
  visible, onClose, theme,
  imageUri, score,
  caption, setCaption,
  selectedMusic, setSelectedMusic,
  musicPicker, setMusicPicker, searchMusic, selectTrack,
  onPublish, onFlammes, onSaveForSelf,
  posting, sendingFlammes, saving,
}) {
  if (!score) return null;
  const busy = posting || sendingFlammes || saving;
  const chips = [
    { k: 'Global', v: score.global, c: theme.accent },
    { k: 'Fit', v: score.fit, c: '#ED93B1' },
    { k: 'Harmonie', v: score.harmonie, c: '#B0809A' },
    { k: 'Détails', v: score.detail, c: '#C9A47A' },
  ];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10} disabled={busy}>
            <Ionicons name="chevron-down" size={26} color={theme.textPri} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.textPri }]}>Personnaliser</Text>
          <View style={{ width: 26 }} />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {/* Aperçu image */}
            {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} /> : null}

            {/* Résumé des notes */}
            <View style={styles.chipsRow}>
              {chips.map(ch => (
                <View key={ch.k} style={[styles.chip, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={[styles.chipVal, { color: ch.c }]}>{ch.v}<Text style={styles.chipMax}>/10</Text></Text>
                  <Text style={[styles.chipKey, { color: theme.textSub }]}>{ch.k}</Text>
                </View>
              ))}
            </View>

            {/* Description */}
            <Text style={[styles.label, { color: theme.textSub }]}>Description</Text>
            <TextInput
              style={[styles.input, styles.inputMulti, { backgroundColor: theme.card, borderColor: theme.border, color: theme.textPri }]}
              placeholder="Ton humeur, le détail de ta tenue..."
              placeholderTextColor={theme.textSub}
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={200}
            />

            {/* Musique (Deezer) */}
            <Text style={[styles.label, { color: theme.textSub }]}>Musique</Text>
            {selectedMusic ? (
              <View style={[styles.musicChip, { backgroundColor: theme.accent + '18' }]}>
                {selectedMusic.coverUrl
                  ? <Image source={{ uri: selectedMusic.coverUrl }} style={styles.musicCover} />
                  : <Text style={styles.musicNote}>♪</Text>}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.musicTitle, { color: theme.textPri }]} numberOfLines={1}>{selectedMusic.title}</Text>
                  <Text style={[styles.musicArtist, { color: theme.textSub }]} numberOfLines={1}>{selectedMusic.artist}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedMusic(null)} hitSlop={8}>
                  <Text style={[styles.musicRemove, { color: theme.textSub }]}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.musicAddBtn, { borderColor: theme.accent + '55' }]}
                onPress={() => setMusicPicker(prev => ({ ...prev, visible: !prev.visible }))}
                activeOpacity={0.8}
              >
                <Text style={[styles.musicAddText, { color: theme.accent }]}>
                  {musicPicker.visible ? 'Fermer la recherche' : '🎵 Ajouter une musique'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Recherche musique inline (pas de modal imbriqué) */}
            {!selectedMusic && musicPicker.visible && (
              <View style={styles.searchWrap}>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.bg, borderColor: theme.border, color: theme.textPri }]}
                  placeholder="Rechercher un titre, un artiste..."
                  placeholderTextColor={theme.textSub}
                  value={musicPicker.query}
                  onChangeText={searchMusic}
                  autoFocus
                />
                {musicPicker.searching && <ActivityIndicator color={theme.accent} style={{ marginVertical: 10 }} />}
                {musicPicker.results.map(track => (
                  <TouchableOpacity key={String(track.id)} style={[styles.resultRow, { borderBottomColor: theme.border }]} onPress={() => selectTrack(track)} activeOpacity={0.75}>
                    {track.coverUrl
                      ? <Image source={{ uri: track.coverUrl }} style={styles.resultCover} />
                      : <View style={[styles.resultCover, { backgroundColor: theme.accent + '44', alignItems: 'center', justifyContent: 'center' }]}><Text>♪</Text></View>}
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.musicTitle, { color: theme.textPri }]} numberOfLines={1}>{track.title}</Text>
                      <Text style={[styles.musicArtist, { color: theme.textSub }]} numberOfLines={1}>{track.artist}</Text>
                    </View>
                    {track.previewUrl ? <Text style={[styles.badge30, { color: theme.accent, backgroundColor: theme.accent + '22' }]}>30s</Text> : null}
                  </TouchableOpacity>
                ))}
                {!musicPicker.searching && musicPicker.query.length >= 2 && musicPicker.results.length === 0 && (
                  <Text style={[styles.noResults, { color: theme.textSub }]}>Aucun résultat</Text>
                )}
              </View>
            )}

            <View style={{ height: 12 }} />
          </ScrollView>

          {/* Barre d'actions fixe */}
          <View style={[styles.actions, { backgroundColor: theme.bg, borderTopColor: theme.border }]}>
            <Bouncy style={[styles.btnPrimary, { backgroundColor: theme.accent }, busy && styles.disabled]} onPress={onPublish} disabled={busy}>
              {posting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnPrimaryText}>🚀 Publier dans le feed</Text>}
            </Bouncy>
            <Bouncy style={[styles.btnSecondary, { borderColor: theme.accent, backgroundColor: theme.card }, busy && styles.disabled]} onPress={onFlammes} disabled={busy}>
              {sendingFlammes ? <ActivityIndicator color={theme.accent} size="small" /> : <Text style={[styles.btnSecondaryText, { color: theme.accent }]}>🔥 Envoyer à mes flammes</Text>}
            </Bouncy>
            <Bouncy style={[styles.btnGhost, busy && styles.disabled]} onPress={onSaveForSelf} disabled={busy}>
              {saving ? <ActivityIndicator color={theme.textSub} size="small" /> : <Text style={[styles.btnGhostText, { color: theme.textSub }]}>💾 Enregistrer pour soi</Text>}
            </Bouncy>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 16, fontWeight: '800' },
  scroll: { padding: 18, paddingBottom: 8 },
  preview: { width: '100%', height: 280, borderRadius: 18, marginBottom: 14 },
  chipsRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  chip:    { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 10, alignItems: 'center' },
  chipVal: { fontSize: 18, fontWeight: '900' },
  chipMax: { fontSize: 10, fontWeight: '700' },
  chipKey: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  label:   { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 6 },
  input:   { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  inputMulti: { minHeight: 80, textAlignVertical: 'top', marginBottom: 6 },
  musicAddBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  musicAddText: { fontSize: 14, fontWeight: '700' },
  musicChip: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 10 },
  musicCover: { width: 42, height: 42, borderRadius: 8 },
  musicNote: { width: 42, height: 42, borderRadius: 8, textAlign: 'center', lineHeight: 42, fontSize: 22, backgroundColor: 'rgba(0,0,0,0.06)' },
  musicTitle: { fontWeight: '700', fontSize: 13 },
  musicArtist: { fontSize: 12, marginTop: 2 },
  musicRemove: { fontSize: 16, paddingHorizontal: 4 },
  searchWrap: { marginTop: 10 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  resultCover: { width: 46, height: 46, borderRadius: 8 },
  badge30: { fontSize: 11, fontWeight: '700', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  noResults: { textAlign: 'center', marginVertical: 14, fontSize: 13 },
  actions: { padding: 16, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  btnPrimary: { borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  btnSecondary: { borderRadius: 14, paddingVertical: 15, alignItems: 'center', borderWidth: 1.5 },
  btnSecondaryText: { fontWeight: '800', fontSize: 15 },
  btnGhost: { paddingVertical: 10, alignItems: 'center' },
  btnGhostText: { fontWeight: '700', fontSize: 13.5 },
  disabled: { opacity: 0.55 },
});
