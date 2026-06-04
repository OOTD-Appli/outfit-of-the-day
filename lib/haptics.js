import { Platform, Vibration } from 'react-native';

// Micro-vibration PWA-safe.
// - Web : navigator.vibrate (ignoré silencieusement sur iOS Safari, jamais de crash).
// - Natif : Vibration API intégrée de React Native (aucune dépendance supplémentaire).
export function triggerHaptic(ms = 12) {
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(ms);
      }
      return;
    }
    Vibration.vibrate(ms);
  } catch (_) {
    // Vibration indisponible (émulateur, permissions) → on ignore.
  }
}
