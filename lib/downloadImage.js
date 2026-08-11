import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library';
// SDK 54 : l'API legacy (downloadAsync / documentDirectory) vit sous /legacy.
import * as FileSystem from 'expo-file-system/legacy';

// Télécharge une image distante dans la pellicule de l'appareil.
//  • Web   : déclenche un téléchargement navigateur via un lien <a download>.
//  • Natif : demande la permission galerie, télécharge le fichier puis l'enregistre.
// Retourne { ok: boolean, reason?: 'permission' | 'error' }.
export async function downloadImageToDevice(imageUrl, fileBaseName = 'ootd_outfit') {
  if (!imageUrl) return { ok: false, reason: 'error' };

  if (Platform.OS === 'web') {
    try {
      if (typeof document === 'undefined') return { ok: false, reason: 'error' };
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${fileBaseName}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      return { ok: true };
    } catch (_) {
      return { ok: false, reason: 'error' };
    }
  }

  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return { ok: false, reason: 'permission' };
    const ext = (imageUrl.split('?')[0].match(/\.(jpe?g|png|webp)$/i)?.[1] || 'jpg').toLowerCase();
    const target = `${FileSystem.documentDirectory}${fileBaseName}_${Date.now()}.${ext}`;
    const { uri } = await FileSystem.downloadAsync(imageUrl, target);
    await MediaLibrary.saveToLibraryAsync(uri);
    // Nettoyage du fichier temporaire (best-effort)
    try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch (_) {}
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: 'error' };
  }
}
