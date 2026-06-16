-- Messages audio (messages vocaux dans le chat)
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS audio_url text;

-- Flux spécialisé par styles (préférence utilisateur)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS specialized_feed boolean NOT NULL DEFAULT false;
