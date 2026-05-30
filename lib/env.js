const {
  EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY,
} = process.env;

export const ENV = {
  supabaseUrl: EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: EXPO_PUBLIC_SUPABASE_ANON_KEY,
};

export function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}
