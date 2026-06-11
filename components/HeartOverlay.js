import { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withSpring, withTiming, withDelay, Easing,
} from 'react-native-reanimated';

const HeartOverlay = forwardRef(function HeartOverlay(_props, ref) {
  const overlayScale   = useSharedValue(0.3);
  const overlayOpacity = useSharedValue(0);
  const overlayRotate  = useSharedValue(0);

  useImperativeHandle(ref, () => ({
    play() {
      overlayScale.value   = 0.3;
      overlayRotate.value  = 0;
      overlayOpacity.value = 1;
      overlayScale.value   = withSpring(1.0, { speed: 16, bounciness: 16 });
      overlayRotate.value  = withTiming(1, { duration: 200, easing: Easing.out(Easing.cubic) });
      overlayOpacity.value = withDelay(280, withTiming(0, { duration: 200 }));
    },
  }));

  const wrapStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: overlayScale.value },
      { rotate: `${overlayRotate.value * -12 + 12}deg` },
    ],
  }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, styles.wrap, wrapStyle]}>
      <Animated.Text style={[styles.icon, iconStyle]}>❤️</Animated.Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 96 },
});

export default HeartOverlay;
