import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

export default function Skeleton({ width, height, borderRadius = 8, style, color = '#D0C8C8' }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: color, opacity }, style]}
    />
  );
}
