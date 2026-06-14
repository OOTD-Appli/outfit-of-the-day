import { View, Text, Image, StyleSheet } from 'react-native';
import { useTheme } from '../lib/themeContext';
import { LOGO_CONFIG } from '../lib/logoConfig';

const DEFAULT_LOGO = require('../assets/logo.jpg');

export default function AppHeader({ title }) {
  const { theme, activeLogo } = useTheme();
  const logoConf = LOGO_CONFIG[activeLogo];
  const logoSrc  = logoConf?.image ?? DEFAULT_LOGO;

  return (
    <View style={[s.bar, { backgroundColor: theme.bg, borderBottomColor: theme.border }]}>
      <Image source={logoSrc} style={s.logo} />
      <Text style={[s.brand, { color: theme.textPri }]}>
        {title || 'OOTD'}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  bar:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  logo:  { width: 32, height: 32, borderRadius: 8 },
  brand: { fontSize: 18, fontWeight: '900', letterSpacing: 0.5 },
});
