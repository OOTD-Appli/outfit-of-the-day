import { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import Animated from 'react-native-reanimated';
import { Pressable } from 'react-native';

// Press-scale réutilisable : remplace un TouchableOpacity en conservant onPress/
// onLongPress/disabled, et ajoute un léger enfoncement élastique au toucher.
// Exécuté sur le thread UI via Reanimated 3 worklets — aucun saut sur le JS thread.
export default function Bouncy({
  onPress, onLongPress, disabled, style, children,
  scaleTo = 0.93, hitSlop, accessibilityLabel, ...rest
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => { scale.value = withSpring(scaleTo, { speed: 50, bounciness: 6 }); }}
      onPressOut={() => { scale.value = withSpring(1, { speed: 50, bounciness: 6 }); }}
      {...rest}
    >
      <Animated.View style={[style, animatedStyle]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
