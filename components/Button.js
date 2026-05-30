import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useTheme } from '../lib/themeContext';

const Button = ({
  title,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary', // primary | secondary | outline
  leftIcon,
  rightIcon,
  accessibilityLabel,
  testID,
  ...props
}) => {
  const { theme } = useTheme();

  const getBackgroundColor = () => {
    if (disabled) return theme.border;
    switch (variant) {
      case 'primary': return theme.accent;
      case 'secondary': return theme.card;
      case 'outline': return 'transparent';
      default: return theme.accent;
    }
  };

  const getTextColor = () => {
    if (disabled) return theme.textSub;
    switch (variant) {
      case 'primary': return '#3a0d1e';
      case 'secondary': return theme.accent;
      case 'outline': return theme.accent;
      default: return '#3a0d1e';
    }
  };

  const getBorderColor = () => {
    if (variant === 'outline' && !disabled) return theme.accent;
    return 'transparent';
  };

  return (
    <TouchableOpacity
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.container, { backgroundColor: getBackgroundColor(), borderColor: getBorderColor() }, props.style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={getTextColor()} style={{ marginRight: 8 }} />
      ) : leftIcon && (
        <Text style={{ marginRight: 4 }}>{leftIcon}</Text>
      )}
      <Text style={[
        styles.text,
        { color: getTextColor() },
        props.textStyle
      ]}>{title}</Text>
      {loading ? null : rightIcon && (
        <Text style={{ marginLeft: 4 }}>{rightIcon}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    ...(Platform.select({ web: {}, default: { elevation: 3 } })),
  },
  text: {
    fontWeight: '600',
    fontSize: 16,
    textAlign: 'center',
  },
});

export default Button;
