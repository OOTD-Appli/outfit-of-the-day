-- OOTD — Web Push : table des abonnements PushSubscription du navigateur (2026-06-01)
-- L'envoi se fait via l'Edge Function `send-web-push` (service_role, clés VAPID).

CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL UNIQUE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS web_push_user_idx ON public.web_push_subscriptions (user_id);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- L'utilisateur ne gère que ses propres abonnements ; le service_role (Edge
-- Function d'envoi) lit tout, hors RLS.
DROP POLICY IF EXISTS wps_select_own ON public.web_push_subscriptions;
CREATE POLICY wps_select_own ON public.web_push_subscriptions
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS wps_insert_own ON public.web_push_subscriptions;
CREATE POLICY wps_insert_own ON public.web_push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS wps_update_own ON public.web_push_subscriptions;
CREATE POLICY wps_update_own ON public.web_push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS wps_delete_own ON public.web_push_subscriptions;
CREATE POLICY wps_delete_own ON public.web_push_subscriptions
  FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));
