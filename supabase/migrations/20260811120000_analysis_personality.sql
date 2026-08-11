-- Personnalité du critique IA (ton/attitude de l'analyse de tenue), choisie par
-- l'utilisateur dans Profil > Paramètres. N'affecte QUE le ton des textes générés
-- (analyses, points forts, axes d'amélioration) — le barème de notation reste
-- identique quelle que soit la personnalité, pour garder les notes/points comparables
-- entre utilisateurs. La correspondance clé -> texte de personnalité vit uniquement
-- côté serveur (supabase/functions/analyze-outfit) — jamais de texte libre du client.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS analysis_personality text NOT NULL DEFAULT 'fashion_week';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_analysis_personality_valid
  CHECK (analysis_personality IN ('fashion_week', 'bienveillant', 'pote_hype', 'coach', 'streetwear'));
