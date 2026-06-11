import { useRef } from 'react';
import { Animated, Pressable } from 'react-native';

export default function Bouncy({
  onPress, onLongPress, disabled, style, children,
  scaleTo = 0.93, hitSlop, accessibilityLabel, ...rest
}) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => Animated.spring(scale, { toValue: scaleTo, speed: 50, bounciness: 6, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1,      speed: 50, bounciness: 6, useNativeDriver: true }).start()}
      {...rest}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
