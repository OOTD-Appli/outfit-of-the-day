import { View, Text, StyleSheet } from 'react-native';

export default function FlammesScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Flammes</Text>
      <Text style={styles.sub}>Bientôt : défis et chat</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', alignItems: 'center', justifyContent: 'center' },
  text:      { fontSize: 28, fontWeight: '700', color: '#fff' },
  sub:       { fontSize: 14, color: '#555', marginTop: 8 },
});