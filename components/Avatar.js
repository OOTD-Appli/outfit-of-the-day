import React, { useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

const Avatar = ({
  uri,
  size = 80,
  username,
  loading = false,
  onPress,
  borderWidth = StyleSheet.hairlineWidth,
  borderColor = '#fff',
  ...props
}) => {
  const [hasError, setHasError] = useState(false);
  const getBackgroundColor = () => '#ED93B1'; // default avatar bg
  const getTextColor = () => '#3a0d1e';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.container, { width: size, height: size, borderRadius: size / 2, borderWidth, borderColor, backgroundColor: getBackgroundColor() }, props.style]}
    >
      {loading ? (
        <ActivityIndicator color="#3a0d1e" size="small" style={{ alignSelf: 'center' }} />
      ) : uri && !hasError ? (
        <ExpoImage
          source={{ uri }}
          style={styles.image}
          contentFit="cover"
          onError={() => setHasError(true)}
        />
      ) : (
        <Text style={[styles.text, { fontSize: size * 0.4, color: getTextColor() }]}>
          {username?.charAt(0).toUpperCase() || '?'}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  text: {
    fontWeight: '800',
    textAlign: 'center',
  },
});

export default Avatar;