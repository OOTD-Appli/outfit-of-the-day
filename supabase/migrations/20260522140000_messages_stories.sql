-- messages: chat éphémère (remplace snaps)
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  receiver_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content text,
  image_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz DEFAULT (now() + interval '24 hours') NOT NULL,
  CONSTRAINT messages_has_content CHECK (content IS NOT NULL OR image_url IS NOT NULL)
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own messages" ON messages FOR SELECT
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

CREATE POLICY "Users send messages" ON messages FOR INSERT
  WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Users delete own sent messages" ON messages FOR DELETE
  USING (sender_id = auth.uid());

-- stories: photos éphémères 24h
CREATE TABLE IF NOT EXISTS stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  image_url text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz DEFAULT (now() + interval '24 hours') NOT NULL
);

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can see active stories" ON stories FOR SELECT
  USING (auth.uid() IS NOT NULL AND expires_at > now());

CREATE POLICY "Users manage own stories" ON stories FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Bucket storage pour les stories
INSERT INTO storage.buckets (id, name, public)
VALUES ('stories', 'stories', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated can upload stories" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'stories');

CREATE POLICY "Anyone can read story files" ON storage.objects FOR SELECT
  USING (bucket_id = 'stories');

CREATE POLICY "Users delete own story files" ON storage.objects FOR DELETE
  USING (bucket_id = 'stories' AND (storage.foldername(name))[1] = auth.uid()::text);
