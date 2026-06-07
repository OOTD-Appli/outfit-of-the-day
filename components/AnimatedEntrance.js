import { useRef, useEffect } from 'react';
import { Animated, Easing } from 'react-native';

// Entrée animée au montage : fade + léger glissement vertical (+ scale optionnel).
// `delay` permet de cascader (stagger) une liste en passant index*step.
// transform + opacity only (useNativeDriver). N'altère ni layout ni logique.
export default function AnimatedEntrance({
  children, style, delay = 0, distance = 12, duration = 320, scaleFrom = 1,
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(t, {
      toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, []);

  const transform = [
    { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) },
  ];
  if (scaleFrom !== 1) {
    transform.push({ scale: t.interpolate({ inputRange: [0, 1], outputRange: [scaleFrom, 1] }) });
  }

  return (
    <Animated.View style={[style, { opacity: t, transform }]}>
      {children}
    </Animated.View>
  );
}
