import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { Appearance, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const STORAGE_KEY = 'ootd_color_mode';

const DARK_PALETTES = {
  default: {
    accent:    '#ED93B1',
    bg:        '#0f0a0c',
    card:      '#1a0f15',
    border:    '#301826',
    textPri:   '#F5E0E8',
    textSub:   '#8A6070',
    tabBar:    '#0f0a0c',
    tabBorder: '#301826',
  },
  midnight: {
    accent:    '#7B9CFF',
    bg:        '#0a0a18',
    card:      '#13132A',
    border:    '#1e1e3a',
    textPri:   '#E8E8FF',
    textSub:   '#6666AA',
    tabBar:    '#0a0a18',
    tabBorder: '#1e1e3a',
  },
  emerald: {
    accent:    '#3ED598',
    bg:        '#081510',
    card:      '#101f18',
    border:    '#1a3025',
    textPri:   '#D0F0E0',
    textSub:   '#5A9070',
    tabBar:    '#081510',
    tabBorder: '#1a3025',
  },
  gold: {
    accent:    '#F5B700',
    bg:        '#15110a',
    card:      '#1f1a0f',
    border:    '#2e2510',
    textPri:   '#F0E8D0',
    textSub:   '#9A8850',
    tabBar:    '#15110a',
    tabBorder: '#2e2510',
  },
  sakura: {
    accent:    '#FF79AC',
    bg:        '#180d12',
    card:      '#221218',
    border:    '#3a1a25',
    textPri:   '#F5D0DC',
    textSub:   '#9A6070',
    tabBar:    '#180d12',
    tabBorder: '#3a1a25',
  },
};

const LIGHT_PALETTES = {
  default: {
    accent:    '#ED93B1',
    bg:        '#FAF7F5',
    card:      '#F3EAE5',
    border:    '#EAD8CE',
    textPri:   '#1A1412',
    textSub:   '#9A8880',
    tabBar:    '#FAF7F5',
    tabBorder: '#EAD8CE',
  },
  midnight: {
    accent:    '#5A7EF0',
    bg:        '#F0F3FF',
    card:      '#E4E9FF',
    border:    '#C8D3F5',
    textPri:   '#1A1A4A',
    textSub:   '#6070AA',
    tabBar:    '#F0F3FF',
    tabBorder: '#C8D3F5',
  },
  emerald: {
    accent:    '#2AB87A',
    bg:        '#F0FAF5',
    card:      '#DCEEE5',
    border:    '#B5D8C8',
    textPri:   '#0A2518',
    textSub:   '#4A8060',
    tabBar:    '#F0FAF5',
    tabBorder: '#B5D8C8',
  },
  gold: {
    accent:    '#D49900',
    bg:        '#FEFDF0',
    card:      '#F5F0D5',
    border:    '#E0D8B0',
    textPri:   '#1A1500',
    textSub:   '#7A6830',
    tabBar:    '#FEFDF0',
    tabBorder: '#E0D8B0',
  },
  sakura: {
    accent:    '#E0508C',
    bg:        '#FFF5F8',
    card:      '#FFE8F0',
    border:    '#FFCCE0',
    textPri:   '#1A0812',
    textSub:   '#8A5060',
    tabBar:    '#FFF5F8',
    tabBorder: '#FFCCE0',
  },
};

function getSystemMode() {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

function getInitialColorMode() {
  // Web: localStorage is synchronous — zero-flash init
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  }
  return getSystemMode();
}

function resolvePalette(themeName, mode) {
  const pool = mode === 'dark' ? DARK_PALETTES : LIGHT_PALETTES;
  return pool[themeName] || pool.default;
}

const ThemeContext = createContext({
  theme: LIGHT_PALETTES.default,
  colorMode: 'light',
  setColorMode: () => {},
  refreshTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [colorMode, setColorModeState] = useState(getInitialColorMode);
  const [activeThemeName, setActiveThemeName] = useState('default');

  const setColorMode = useCallback(async (mode) => {
    setColorModeState(mode);
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, mode);
      } else {
        await AsyncStorage.setItem(STORAGE_KEY, mode);
      }
    } catch (_) {}
    try {
      await supabase.auth.updateUser({ data: { dark_mode: mode === 'dark' } });
    } catch (_) {}
  }, []);

  const refreshTheme = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setActiveThemeName('default'); return; }

      const { data } = await supabase
        .from('profiles')
        .select('active_theme')
        .eq('id', user.id)
        .single();
      setActiveThemeName(data?.active_theme || 'default');

      // user_metadata.dark_mode takes priority (cross-device sync)
      const darkMeta = user.user_metadata?.dark_mode;
      if (typeof darkMeta === 'boolean') {
        const mode = darkMeta ? 'dark' : 'light';
        setColorModeState(mode);
        try {
          if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, mode);
          } else {
            AsyncStorage.setItem(STORAGE_KEY, mode);
          }
        } catch (_) {}
        return;
      }

      // Native: AsyncStorage fallback (web already read synchronously at init)
      if (Platform.OS !== 'web') {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'dark' || stored === 'light') setColorModeState(stored);
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) refreshTheme();
      else setActiveThemeName('default');
    });
    refreshTheme();
    return () => data.subscription.unsubscribe();
  }, [refreshTheme]);

  // Follow system appearance changes only when user has no explicit preference stored
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      (async () => {
        try {
          let hasStored = false;
          if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
            hasStored = localStorage.getItem(STORAGE_KEY) !== null;
          } else {
            hasStored = (await AsyncStorage.getItem(STORAGE_KEY)) !== null;
          }
          if (!hasStored) setColorModeState(colorScheme === 'dark' ? 'dark' : 'light');
        } catch (_) {}
      })();
    });
    return () => sub.remove();
  }, []);

  const contextValue = useMemo(() => ({
    theme: resolvePalette(activeThemeName, colorMode),
    colorMode,
    setColorMode,
    refreshTheme,
  }), [activeThemeName, colorMode, setColorMode, refreshTheme]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
