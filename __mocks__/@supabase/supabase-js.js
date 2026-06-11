// Mock minimal de @supabase/supabase-js pour les tests unitaires
const createClient = jest.fn(() => ({}));

module.exports = { createClient };
