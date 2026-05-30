import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { supabase } from './supabase';

const PALETTES = {
  default: {
    accent:   '#ED93B1',
    bg:       '#FAF7F5',
    card:     '#F3EAE5',
    border:   '#EAD8CE',
    textPri:  '#1A1412',
    textSub:  '#9A8880',
    tabBar:   '#FAF7F5',
    tabBorder:'#EAD8CE',
  },
  midnight: {
    accent:   '#7B9CFF',
    bg:       '#0a0a18',
    card:     '#13132A',
    border:   '#1e1e3a',
    textPri:  '#E8E8FF',
    textSub:  '#6666AA',
    tabBar:   '#0a0a18',
    tabBorder:'#1e1e3a',
  },
  emerald: {
    accent:   '#3ED598',
    bg:       '#081510',
    card:     '#101f18',
    border:   '#1a3025',
    textPri:  '#D0F0E0',
    textSub:  '#5A9070',
    tabBar:   '#081510',
    tabBorder:'#1a3025',
  },
  gold: {
    accent:   '#F5B700',
    bg:       '#15110a',
    card:     '#1f1a0f',
    border:   '#2e2510',
    textPri:  '#F0E8D0',
    textSub:  '#9A8850',
    tabBar:   '#15110a',
    tabBorder:'#2e2510',
  },
  sakura: {
    accent:   '#FF79AC',
    bg:       '#180d12',
    card:     '#221218',
    border:   '#3a1a25',
    textPri:  '#F5D0DC',
    textSub:  '#9A6070',
    tabBar:   '#180d12',
    tabBorder:'#3a1a25',
  },
};

const ThemeContext = createContext({
  theme: PALETTES.default,
  refreshTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(PALETTES.default);

  const refreshTheme = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setTheme(PALETTES.default); return; }
      const { data } = await supabase
        .from('profiles')
        .select('active_theme')
        .eq('id', user.id)
        .single();
      setTheme(PALETTES[data?.active_theme] || PALETTES.default);
    } catch (_) {}
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) refreshTheme();
      else setTheme(PALETTES.default);
    });
    refreshTheme();
    return () => data.subscription.unsubscribe();
  }, [refreshTheme]);

  return (
    <ThemeContext.Provider value={{ theme, refreshTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
