import { useRef } from 'react';
import { Animated, Pressable } from 'react-native';

// Press-scale réutilisable : remplace un TouchableOpacity en conservant onPress/
// onLongPress/disabled, et ajoute un léger enfoncement élastique au toucher.
// transform-only (useNativeDriver) → aucun coût layout, ne change pas la logique.
export default function Bouncy({
  onPress, onLongPress, disabled, style, children,
  scaleTo = 0.93, hitSlop, accessibilityLabel, ...rest
}) {
  const s = useRef(new Animated.Value(1)).current;
  const animate = (to) =>
    Animated.spring(s, { toValue: to, useNativeDriver: true, speed: 50, bounciness: 6 }).start();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => animate(scaleTo)}
      onPressOut={() => animate(1)}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
