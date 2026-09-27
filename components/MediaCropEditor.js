// Recadrage/zoom pinch+pan avant publication — utilisé pour les photos de tenue,
// les photos de chat, les stories (photo ET vidéo).
//
// Deux modes de résultat (`onConfirm`), explicitement discriminés :
//   - Photos : { mode: 'baked', asset: { uri, base64, uploadBase64, uploadMime, width, height } }
//     Crop DESTRUCTIF, calculé sur la source en pleine résolution (jamais sur une version
//     déjà réduite) — web : canvas ; natif : expo-image-manipulator.
//   - Vidéos (stories) : { mode: 'transform', scale, offsetX, offsetY }
//     Pas de ré-encodage (irréaliste avec Expo) : seul le cadrage choisi est renvoyé,
//     à stocker et réappliquer à l'affichage (cf. stories.media_scale/media_offset_x/y).
//
// Rotation volontairement hors scope (pas de bouton, pas de geste de rotation).
import { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, Platform, Image as RNImage } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../lib/themeContext';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const MAX_OUTPUT_DIM = 1600; // plafond de sortie pour le crop destructif (photos)

function getImageSize(uri) {
  return new Promise((resolve, reject) => {
    RNImage.getSize(uri, (width, height) => resolve({ width, height }), reject);
  });
}

// Web : dessine la zone recadrée sur un canvas et renvoie les deux encodages déjà
// utilisés ailleurs dans l'app (JPEG pour l'analyse IA, WebP pour le stockage feed —
// même principe que pickImageWeb dans AccueilScreen.js), à résolution pleine (avant
// tout redimensionnement) puis plafonnés à MAX_OUTPUT_DIM.
async function bakeCropWeb(uri, crop) {
  const img = await new Promise((resolve, reject) => {
    const el = new window.Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = uri;
  });

  let outW = crop.width;
  let outH = crop.height;
  const maxDim = Math.max(outW, outH);
  if (maxDim > MAX_OUTPUT_DIM) {
    const ratio = MAX_OUTPUT_DIM / maxDim;
    outW = Math.round(outW * ratio);
    outH = Math.round(outH * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, crop.originX, crop.originY, crop.width, crop.height, 0, 0, outW, outH);

  const jpegUrl = canvas.toDataURL('image/jpeg', 0.8);
  let uploadMime = 'image/webp';
  let uploadUrl = canvas.toDataURL(uploadMime, 0.75);
  if (!uploadUrl.startsWith('data:image/webp')) { uploadMime = 'image/jpeg'; uploadUrl = jpegUrl; }

  return {
    uri: uploadUrl,
    base64: jpegUrl.split(',')[1] || null,
    uploadBase64: uploadUrl.split(',')[1] || null,
    uploadMime,
    width: outW,
    height: outH,
  };
}

// Natif : expo-image-manipulator. Le crop opère sur l'espace de coordonnées "brut"
// du fichier — attention EXIF sur les photos portrait (voir plan, vérification dédiée
// à faire avant de considérer ce chemin fiable en prod).
async function bakeCropNative(uri, crop) {
  const actions = [{ crop }];
  const maxDim = Math.max(crop.width, crop.height);
  if (maxDim > MAX_OUTPUT_DIM) {
    const ratio = MAX_OUTPUT_DIM / maxDim;
    actions.push({ resize: { width: Math.round(crop.width * ratio), height: Math.round(crop.height * ratio) } });
  }
  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    base64: true,
    format: ImageManipulator.SaveFormat.JPEG,
    compress: 0.8,
  });
  return {
    uri: result.uri,
    base64: result.base64,
    uploadBase64: result.base64,
    uploadMime: 'image/jpeg',
    width: result.width,
    height: result.height,
  };
}

export default function MediaCropEditor({ visible, uri, mediaType = 'image', aspect = 3 / 4, onConfirm, onCancel }) {
  const { theme } = useTheme();
  const [mediaSize, setMediaSize] = useState(null); // { width, height } intrinsèque de la source
  const [frameSize, setFrameSize] = useState(null); // { width, height } du cadre à l'écran
  const [confirming, setConfirming] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  // Bornes courantes (dépendent de mediaSize+frameSize, connues seulement après layout/chargement).
  // dispW/dispH = taille affichée du média à scale=1 (le "cover" de base, avant le pinch
  // de l'utilisateur) ; frameW/frameH = taille du cadre. La translation étant appliquée
  // APRÈS le scale dans la composition des transforms (mêmes unités écran quel que soit
  // le zoom courant), la borne correcte à un facteur de zoom `s` donné est
  // (dispW*s - frameW)/2 — et non maxOffsetX(1)*s, qui sous-estime la marge dès que s>1.
  const boundsRef = useRef({ dispW: 0, dispH: 0, frameW: 0, frameH: 0 });

  const clamp = (v, max) => Math.min(max, Math.max(-max, v));

  const dynMax = (dim, frameDim, s) => Math.max(0, (dim * s - frameDim) / 2);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      const { dispW, dispH, frameW, frameH } = boundsRef.current;
      translateX.value = clamp(translateX.value, dynMax(dispW, frameW, scale.value));
      translateY.value = clamp(translateY.value, dynMax(dispH, frameH, scale.value));
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      const { dispW, dispH, frameW, frameH } = boundsRef.current;
      translateX.value = clamp(translateX.value, dynMax(dispW, frameW, scale.value));
      translateY.value = clamp(translateY.value, dynMax(dispH, frameH, scale.value));
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinch, pan);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // Recalcule les bornes de pan (dépend de la taille du cadre + de la source) et
  // remet le cadrage à l'état neutre à chaque nouvelle ouverture/média.
  const resetForMedia = useCallback((mSize, fSize) => {
    const baseScale = Math.max(fSize.width / mSize.width, fSize.height / mSize.height);
    boundsRef.current = {
      dispW: mSize.width * baseScale,
      dispH: mSize.height * baseScale,
      frameW: fSize.width,
      frameH: fSize.height,
      baseScale,
    };
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, []);

  const onFrameLayout = useCallback((e) => {
    const fSize = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height };
    setFrameSize(fSize);
    if (mediaSize) resetForMedia(mediaSize, fSize);
  }, [mediaSize, resetForMedia]);

  // Image : dimensions récupérées via Image.getSize (natif) / Image() (web, dans bakeCropWeb
  // on refait un décodage propre de toute façon, ici on veut juste w/h pour le cadrage).
  const onImageContainerReady = useCallback(async () => {
    if (mediaType !== 'image' || !uri || mediaSize) return;
    try {
      const size = await getImageSize(uri);
      setMediaSize(size);
      if (frameSize) resetForMedia(size, frameSize);
    } catch (_) {
      // Taille illisible : on affiche quand même, le cadrage sera approximatif (rare).
      setMediaSize({ width: 1, height: 1 });
    }
  }, [mediaType, uri, mediaSize, frameSize, resetForMedia]);

  // Vidéo : dimensions via le statut de chargement d'expo-av.
  const onVideoLoad = useCallback((status) => {
    if (mediaSize) return;
    const natural = status?.naturalSize;
    const size = natural?.width && natural?.height ? { width: natural.width, height: natural.height } : { width: 9, height: 16 };
    setMediaSize(size);
    if (frameSize) resetForMedia(size, frameSize);
  }, [mediaSize, frameSize, resetForMedia]);

  const handleConfirm = async () => {
    if (!mediaSize || !frameSize || confirming) return;
    setConfirming(true);
    try {
      const { baseScale } = boundsRef.current;
      const s = scale.value;
      const totalScale = baseScale * s;
      const dispW = mediaSize.width * totalScale;
      const dispH = mediaSize.height * totalScale;

      if (mediaType === 'video') {
        // Normalisé (0-1) par rapport au cadre — pas de dépendance aux pixels d'un
        // conteneur particulier, réappliqué identiquement partout où la story s'affiche.
        onConfirm({
          mode: 'transform',
          scale: s,
          offsetX: frameSize.width ? translateX.value / frameSize.width : 0,
          offsetY: frameSize.height ? translateY.value / frameSize.height : 0,
        });
        return;
      }

      const cropXDisplayed = dispW / 2 - frameSize.width / 2 - translateX.value;
      const cropYDisplayed = dispH / 2 - frameSize.height / 2 - translateY.value;
      const crop = {
        originX: Math.max(0, Math.round(cropXDisplayed / totalScale)),
        originY: Math.max(0, Math.round(cropYDisplayed / totalScale)),
        width: Math.min(mediaSize.width, Math.round(frameSize.width / totalScale)),
        height: Math.min(mediaSize.height, Math.round(frameSize.height / totalScale)),
      };

      const asset = Platform.OS === 'web' ? await bakeCropWeb(uri, crop) : await bakeCropNative(uri, crop);
      onConfirm({ mode: 'baked', asset });
    } catch (e) {
      setConfirming(false);
      // L'appelant reste responsable d'afficher une erreur (showToast) — on ne
      // ferme pas silencieusement pour que l'utilisateur puisse réessayer.
      throw e;
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onCancel} style={styles.headerBtn} disabled={confirming}>
            <Feather name="x" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ajuster</Text>
          <TouchableOpacity onPress={handleConfirm} style={styles.headerBtn} disabled={confirming || !mediaSize}>
            {confirming ? <ActivityIndicator size="small" color={theme.accent} /> : <Feather name="check" size={24} color={theme.accent} />}
          </TouchableOpacity>
        </View>

        <View style={[styles.frame, { aspectRatio: aspect }]} onLayout={onFrameLayout}>
          {!mediaSize && (
            <View style={styles.loadingWrap}><ActivityIndicator color={theme.accent} /></View>
          )}
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={[styles.mediaWrap, animatedStyle]}>
              {mediaType === 'video' ? (
                <Video
                  source={{ uri }}
                  style={styles.media}
                  resizeMode={ResizeMode.COVER}
                  isLooping
                  shouldPlay
                  onLoad={onVideoLoad}
                />
              ) : (
                <RNImage
                  source={{ uri }}
                  style={styles.media}
                  resizeMode="cover"
                  onLoad={onImageContainerReady}
                />
              )}
            </Animated.View>
          </GestureDetector>
        </View>

        <Text style={styles.hint}>Pince pour zoomer · glisse pour déplacer</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 50, paddingBottom: 12, zIndex: 2,
  },
  headerBtn: { padding: 8 },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  frame: { width: '92%', maxHeight: '78%', overflow: 'hidden', backgroundColor: '#111' },
  loadingWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  mediaWrap: { width: '100%', height: '100%' },
  media: { width: '100%', height: '100%' },
  hint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 16 },
});
