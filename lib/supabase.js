import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ENV, requireEnv } from './env';

const SUPABASE_URL = requireEnv('EXPO_PUBLIC_SUPABASE_URL', ENV.supabaseUrl);
const SUPABASE_ANON_KEY = requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', ENV.supabaseAnonKey);

const isWeb = Platform.OS === 'web';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Sur web, on laisse Supabase parser le token de récupération de mot de passe
    // présent dans l'URL (lien email → évènement PASSWORD_RECOVERY). Inutile/risqué
    // côté natif (pas d'URL de page) → désactivé.
    detectSessionInUrl: isWeb,
  },
});