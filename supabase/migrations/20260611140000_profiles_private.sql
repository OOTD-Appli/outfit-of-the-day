-- OOTD — Table profiles_private (SEC-14)
-- Isole push_token hors de profiles pour éviter la fuite via profiles_select_authenticated.
-- profiles_private est lisible/modifiable uniquement par le propriétaire (RLS stricte).
-- La clé service_role peut la lire pour envoyer des notifications push côté serveur.

CREATE TABLE IF NOT EXISTS public.profiles_private (
  id        uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  push_token text
);

ALTER TABLE public.profiles_private ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_private_select_own" ON public.profiles_private
  FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));

CREATE POLICY "profiles_private_insert_own" ON public.profiles_private
  FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY "profiles_private_update_own" ON public.profiles_private
  FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- Migre les push_tokens existants vers profiles_private
INSERT INTO public.profiles_private (id, push_token)
SELECT id, push_token FROM public.profiles
WHERE push_token IS NOT NULL
ON CONFLICT (id) DO UPDATE SET push_token = EXCLUDED.push_token;

-- Supprime la colonne push_token de profiles (maintenant dans profiles_private)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS push_token;
