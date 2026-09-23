-- OOTD — FK competition_members.user_id : auth.users(id) -> profiles(id) (2026-09-28)
-- Bug réel rencontré en prod (toast "Could not find a relationship between
-- 'competition_members' and 'profiles' in the schema cache") : la FK existait
-- déjà (competition_members_user_id_fkey) mais pointait vers auth.users(id),
-- pas profiles(id) — invisible via information_schema.constraint_column_usage
-- sur ce self-host (vue qui ne résout pas fiablement les cibles cross-schema
-- ici), confirmé directement via pg_constraint. Même piège déjà rencontré sur
-- competition_messages.sender_id (voir Post-mortems ARCHITECTURE.md) : une
-- colonne destinée à être embed-jointe avec profiles(...) côté client doit
-- référencer profiles(id), jamais auth.users(id), sinon PostgREST ne trouve
-- aucune relation. Ça n'avait jamais posé de problème tant que personne
-- n'essayait d'embed profiles(...) directement depuis competition_members (le
-- carrousel "tenues du jour" de l'écran Compétition v4 est le premier endroit
-- à le faire).

ALTER TABLE public.competition_members
  DROP CONSTRAINT competition_members_user_id_fkey;

ALTER TABLE public.competition_members
  ADD CONSTRAINT competition_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

NOTIFY pgrst, 'reload schema';
