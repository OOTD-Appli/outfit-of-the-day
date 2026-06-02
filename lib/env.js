// ⚠️ Lire les variables EXPO_PUBLIC_* en accès DIRECT `process.env.X` (membre),
// jamais par déstructuration : seul l'accès direct est inliné au build par
// babel-preset-expo. Une déstructuration `const { X } = process.env` reste
// `undefined` dans les builds de production (web export & EAS).
export const ENV = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  groqApiKey: process.env.EXPO_PUBLIC_GROQ_API_KEY, // conservé pour compatibilité, non utilisé côté client
};

export function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name}`);
  }
  return value;
}
