import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ENV, requireEnv } from './env';

const SUPABASE_URL = requireEnv('EXPO_PUBLIC_SUPABASE_URL', ENV.supabaseUrl);
const SUPABASE_ANON_KEY = requireEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', ENV.supabaseAnonKey);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});