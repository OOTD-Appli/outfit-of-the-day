-- OOTD — schéma initial aligné avec l’app React Native (screens + storage).
-- Application : tableau SQL Editor Supabase, ou CLI : `supabase db push`.
-- Buckets créés ci-dessous : `avatars`, `ootds` (publics en lecture).

-- Extensions utiles

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username text UNIQUE NOT NULL,
  avatar_url text,
  push_token text,
  points integer NOT NULL DEFAULT 0,
  niveau integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ootds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  image_url text NOT NULL,
  score_global numeric NOT NULL,
  score_couleurs numeric NOT NULL,
  score_coupe numeric NOT NULL,
  score_tendance numeric NOT NULL,
  conseil text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  ootd_id uuid NOT NULL REFERENCES public.ootds (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now (),
  UNIQUE (user_id, ootd_id)
);

CREATE TABLE public.friendships (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now (),
  PRIMARY KEY (user_id, friend_id),
  CONSTRAINT friendships_no_self CHECK (user_id <> friend_id)
);

CREATE TABLE public.flammes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user1_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  user2_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  streak integer NOT NULL DEFAULT 0,
  last_snap_at timestamptz,
  CONSTRAINT flammes_ordered CHECK (user1_id < user2_id),
  UNIQUE (user1_id, user2_id)
);

CREATE TABLE public.snaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  sender_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  image_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now ()
);

CREATE INDEX idx_ootds_user_id ON public.ootds (user_id);
CREATE INDEX idx_ootds_created_at ON public.ootds (created_at DESC);
CREATE INDEX idx_likes_ootd_id ON public.likes (ootd_id);
CREATE INDEX idx_snaps_pair ON public.snaps (sender_id, receiver_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ootds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flammes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snaps ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid ()));

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid ()))
  WITH CHECK (id = (SELECT auth.uid ()));

-- ootds
CREATE POLICY "ootds_select_authenticated"
  ON public.ootds FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "ootds_insert_own"
  ON public.ootds FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid ()));

-- likes
CREATE POLICY "likes_select_authenticated"
  ON public.likes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "likes_insert_own"
  ON public.likes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid ()));

CREATE POLICY "likes_delete_own"
  ON public.likes FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid ()));

-- friendships
CREATE POLICY "friendships_select_involved"
  ON public.friendships FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid ())
    OR friend_id = (SELECT auth.uid ())
  );

CREATE POLICY "friendships_mutate_involved"
  ON public.friendships FOR ALL
  TO authenticated
  USING (
    user_id = (SELECT auth.uid ())
    OR friend_id = (SELECT auth.uid ())
  )
  WITH CHECK (
    user_id = (SELECT auth.uid ())
    OR friend_id = (SELECT auth.uid ())
  );

-- flammes
CREATE POLICY "flammes_select_involved"
  ON public.flammes FOR SELECT
  TO authenticated
  USING (
    user1_id = (SELECT auth.uid ())
    OR user2_id = (SELECT auth.uid ())
  );

CREATE POLICY "flammes_mutate_involved"
  ON public.flammes FOR ALL
  TO authenticated
  USING (
    user1_id = (SELECT auth.uid ())
    OR user2_id = (SELECT auth.uid ())
  )
  WITH CHECK (
    user1_id = (SELECT auth.uid ())
    OR user2_id = (SELECT auth.uid ())
  );

-- snaps
CREATE POLICY "snaps_select_participants"
  ON public.snaps FOR SELECT
  TO authenticated
  USING (
    sender_id = (SELECT auth.uid ())
    OR receiver_id = (SELECT auth.uid ())
  );

CREATE POLICY "snaps_insert_sender"
  ON public.snaps FOR INSERT
  TO authenticated
  WITH CHECK (sender_id = (SELECT auth.uid ()));

-- ---------------------------------------------------------------------------
-- Storage (buckets publics en lecture pour getPublicUrl côté app)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('avatars', 'avatars', true),
  ('ootds', 'ootds', true)
ON CONFLICT (id) DO NOTHING;

-- Lecture publique des fichiers
CREATE POLICY "storage_avatars_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'avatars');

CREATE POLICY "storage_ootds_public_read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'ootds');

-- Upload : avatar dans <uid>/…
CREATE POLICY "storage_avatars_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND split_part (name, '/', 1) = (SELECT auth.uid ()::text)
  );

-- Upload OOTD : <uid>/… ou snaps/<uid>/…
CREATE POLICY "storage_ootds_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ootds'
    AND (
      split_part (name, '/', 1) = (SELECT auth.uid ()::text)
      OR (
        split_part (name, '/', 1) = 'snaps'
        AND split_part (name, '/', 2) = (SELECT auth.uid ()::text)
      )
    )
  );
