-- OOTD — Index de performance (2026-06-03)
-- Couvre les filtres et tris les plus fréquents de l'app.

-- Feed & profil
CREATE INDEX IF NOT EXISTS idx_ootds_created      ON public.ootds(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ootds_user_created ON public.ootds(user_id, created_at DESC);

-- Chat
CREATE INDEX IF NOT EXISTS idx_messages_pair_exp  ON public.messages(sender_id, receiver_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_messages_created   ON public.messages(created_at ASC);

-- Amitié
CREATE INDEX IF NOT EXISTS idx_friend_user_status   ON public.friendships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_friend_status ON public.friendships(friend_id, status);

-- Likes
CREATE INDEX IF NOT EXISTS idx_likes_ootd          ON public.likes(ootd_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_ootd     ON public.likes(user_id, ootd_id);

-- Flammes
CREATE INDEX IF NOT EXISTS idx_flammes_users       ON public.flammes(user1_id, user2_id);

-- Stories
CREATE INDEX IF NOT EXISTS idx_stories_user_exp    ON public.stories(user_id, expires_at);

-- Snaps
CREATE INDEX IF NOT EXISTS idx_snaps_pair_created  ON public.snaps(sender_id, receiver_id, created_at DESC);
