-- Style analytics (Task A) + toggle hashtag (Task B)
ALTER TABLE public.ootds ADD COLUMN IF NOT EXISTS styles text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.ootds ADD COLUMN IF NOT EXISTS show_style_hashtag boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS style_stats jsonb NOT NULL DEFAULT '{}'::jsonb;

-- RPC : incrémente les compteurs de styles du profil courant
CREATE OR REPLACE FUNCTION public.increment_style_stats(p_styles text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_style text;
  v_stats jsonb;
BEGIN
  IF p_styles IS NULL OR array_length(p_styles, 1) IS NULL THEN RETURN; END IF;
  SELECT COALESCE(style_stats, '{}'::jsonb)
  INTO v_stats
  FROM profiles
  WHERE id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  FOREACH v_style IN ARRAY p_styles LOOP
    v_stats := jsonb_set(
      v_stats,
      ARRAY[v_style],
      to_jsonb(COALESCE((v_stats ->> v_style)::int, 0) + 1),
      true
    );
  END LOOP;
  UPDATE profiles SET style_stats = v_stats WHERE id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_style_stats(text[]) TO authenticated;
