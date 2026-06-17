import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Modal, View, TouchableOpacity, Text, StyleSheet,
  Platform, ActivityIndicator, StatusBar,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

// CameraView (expo-camera 16+) supporte web via getUserMedia.
// Import conditionnel pour éviter un crash si le module n'est pas installé.
let CameraView = null;
let useCameraPermissions = () => [null, async () => ({ granted: false })];
try {
  const cam = require('expo-camera');
  CameraView = cam.CameraView;
  if (cam.useCameraPermissions) useCameraPermissions = cam.useCameraPermissions;
} catch (_) {}

const ACCENT = '#ED93B1';

export default function InAppCamera({ visible, mode = 'photo', onCapture, onClose }) {
  const [facing, setFacing] = useState('back');
  const [isRecording, setIsRecording] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef(null);

  // Remet à zéro l'état quand la modale se ferme
  useEffect(() => {
    if (!visible) setIsRecording(false);
  }, [visible]);

  const toggleFacing = () => setFacing(f => (f === 'back' ? 'front' : 'back'));

  const capture = useCallback(async () => {
    if (!cameraRef.current) return;
    if (mode === 'video') {
      if (isRecording) {
        cameraRef.current.stopRecording();
        setIsRecording(false);
      } else {
        setIsRecording(true);
        try {
          const video = await cameraRef.current.recordAsync({ maxDuration: 30 });
          setIsRecording(false);
          if (video?.uri) onCapture({ uri: video.uri, type: 'video' });
        } catch (_) {
          setIsRecording(false);
        }
      }
    } else {
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          base64: true,
          skipProcessing: Platform.OS === 'android',
        });
        onCapture({ uri: photo.uri, base64: photo.base64, width: photo.width, height: photo.height, type: 'photo' });
      } catch (e) {
        console.warn('[InAppCamera] takePictureAsync:', e?.message);
      }
    }
  }, [isRecording, mode, onCapture]);

  if (!CameraView || !visible) return null;

  // En attente du résultat de la permission
  if (!permission) {
    return (
      <Modal visible transparent animationType="fade">
        <View style={styles.container}>
          <ActivityIndicator color={ACCENT} size="large" />
        </View>
      </Modal>
    );
  }

  // Permission refusée → afficher un écran d'invite
  if (!permission.granted) {
    return (
      <Modal visible transparent animationType="fade">
        <View style={[styles.container, styles.permContainer]}>
          <Ionicons name="camera-outline" size={56} color={ACCENT} style={{ marginBottom: 16 }} />
          <Text style={styles.permText}>Autoriser l'accès à la caméra pour prendre une photo directement dans l'app.</Text>
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Autoriser la caméra</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.permCancelBtn} onPress={onClose}>
            <Text style={styles.permCancelText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.container}>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode={mode === 'video' ? 'video' : 'picture'}
        />

        {/* Barre supérieure : fermer + retourner */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconBtn} onPress={onClose}>
            <Feather name="x" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={toggleFacing}>
            <Ionicons name="camera-reverse-outline" size={26} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Barre inférieure : bouton déclencheur */}
        <View style={styles.bottomBar}>
          {mode === 'video' && isRecording && (
            <View style={styles.recIndicator}>
              <View style={styles.recDot} />
              <Text style={styles.recLabel}>REC</Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.captureBtn, isRecording && styles.captureBtnRec]}
            onPress={capture}
            activeOpacity={0.85}
          >
            {mode === 'video' ? (
              <View style={[styles.captureBtnInner, isRecording && styles.captureBtnInnerStop]} />
            ) : (
              <View style={styles.captureShutter} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  permContainer: {
    paddingHorizontal: 36,
  },
  permText: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  permBtn: {
    paddingHorizontal: 28,
    paddingVertical: 13,
    backgroundColor: ACCENT,
    borderRadius: 26,
    marginBottom: 12,
  },
  permBtnText: { color: '#1a0a10', fontWeight: '800', fontSize: 15 },
  permCancelBtn: { paddingVertical: 10 },
  permCancelText: { color: 'rgba(255,255,255,0.55)', fontSize: 14 },
  topBar: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 56,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  recIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
  },
  recDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF4A4A',
  },
  recLabel: { color: '#FF4A4A', fontWeight: '700', fontSize: 13 },
  captureBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
    shadowColor: ACCENT,
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  captureBtnRec: {
    backgroundColor: '#FF4A4A',
    borderColor: '#FF4A4A',
    shadowColor: '#FF4A4A',
  },
  captureShutter: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
  },
  captureBtnInner: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  captureBtnInnerStop: {
    borderRadius: 4,
  },
});
