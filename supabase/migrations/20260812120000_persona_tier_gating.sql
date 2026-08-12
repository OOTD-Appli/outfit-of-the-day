-- Gating des personnalités IA par tier (Cahier des charges Monétisation 2026-08-12) :
--   coach        -> Gratuit
--   bienveillant -> Plus (ou pass legacy has_ootd_plus_pass / has_analysis_pass)
--   pote_hype, fashion_week, streetwear -> Elite uniquement
--
-- 'fashion_week' était la personnalité par défaut (migration 20260811120000) ; elle
-- devient Elite-only, donc :
--   1) tout profil non-Elite actuellement sur une personnalité désormais hors de
--      portée est ramené sur 'coach' (seule personnalité garantie accessible à tous),
--   2) le défaut de la colonne passe à 'coach' pour les nouveaux profils.

-- Personnalités Elite-only détenues par un profil qui n'est pas Elite
UPDATE public.profiles p
SET analysis_personality = 'coach'
WHERE p.analysis_personality IN ('fashion_week', 'pote_hype', 'streetwear')
  AND NOT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = p.id AND s.status IN ('active', 'trialing') AND s.plan_type = 'elite'
  );

-- Personnalité Plus détenue par un profil qui n'est ni Plus ni Elite (ni pass legacy)
UPDATE public.profiles p
SET analysis_personality = 'coach'
WHERE p.analysis_personality = 'bienveillant'
  AND NOT (
    p.has_ootd_plus_pass OR p.has_analysis_pass
    OR EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = p.id AND s.status IN ('active', 'trialing') AND s.plan_type IN ('plus', 'elite')
    )
  );

ALTER TABLE public.profiles ALTER COLUMN analysis_personality SET DEFAULT 'coach';
