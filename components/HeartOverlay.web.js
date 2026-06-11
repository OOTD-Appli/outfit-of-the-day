import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

const HeartOverlay = forwardRef(function HeartOverlay(_props, ref) {
  const overlayScale   = useRef(new Animated.Value(0.3)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const overlayRotate  = useRef(new Animated.Value(0)).current;

  useImperativeHandle(ref, () => ({
    play() {
      overlayScale.setValue(0.3);
      overlayRotate.setValue(0);
      overlayOpacity.setValue(1);
      Animated.parallel([
        Animated.spring(overlayScale,   { toValue: 1.0, speed: 16, bounciness: 16, useNativeDriver: true }),
        Animated.timing(overlayRotate,  { toValue: 1,   duration: 200, useNativeDriver: true }),
        Animated.sequence([
          Animated.delay(280),
          Animated.timing(overlayOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        ]),
      ]).start();
    },
  }));

  const rotation = overlayRotate.interpolate({ inputRange: [0, 1], outputRange: ['12deg', '0deg'] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, styles.wrap, { opacity: overlayOpacity }]}
    >
      <Animated.Text style={[styles.icon, { transform: [{ scale: overlayScale }, { rotate: rotation }] }]}>
        ❤️
      </Animated.Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 96 },
});

export default HeartOverlay;
