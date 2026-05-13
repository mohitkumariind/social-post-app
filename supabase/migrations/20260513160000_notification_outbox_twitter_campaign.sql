-- Phase 6: Twitter campaign notification outbox (enqueue + delivery worker), idempotent per assignment, retries, cooldown.

CREATE TABLE IF NOT EXISTS public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.twitter_campaigns (id) ON DELETE CASCADE,
  wave_id uuid NOT NULL REFERENCES public.twitter_campaign_waves (id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.twitter_campaign_user_assignments (id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  lock_token text,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  CONSTRAINT notification_outbox_attempts_nonnegative CHECK (attempts >= 0),
  CONSTRAINT notification_outbox_uq_assignment UNIQUE (assignment_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_pending_retry
  ON public.notification_outbox (status, next_retry_at ASC, id ASC)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_notification_outbox_processing_lease
  ON public.notification_outbox (locked_at ASC, id ASC)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_notification_outbox_user_sent
  ON public.notification_outbox (user_id, sent_at DESC)
  WHERE status = 'sent' AND sent_at IS NOT NULL;

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

-- Idempotent enqueue: one outbox row per assignment (skips duplicates).
CREATE OR REPLACE FUNCTION public.twitter_campaign_enqueue_notification_outbox(p_wave_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  n int;
BEGIN
  WITH ins AS (
  INSERT INTO public.notification_outbox (
    user_id,
    campaign_id,
    wave_id,
    assignment_id,
    payload,
    status,
    next_retry_at
  )
  SELECT
    a.user_id,
    a.campaign_id,
    a.wave_id,
    a.id,
    jsonb_build_object(
      'title', COALESCE(NULLIF(btrim(c.title), ''), 'Campaign'),
      'body', 'Tap to view your campaign action.'
    ),
    'pending',
    now()
  FROM public.twitter_campaign_user_assignments a
  INNER JOIN public.twitter_campaigns c ON c.id = a.campaign_id
  WHERE a.wave_id = p_wave_id
  ON CONFLICT (assignment_id) DO NOTHING
  RETURNING id
  )
  SELECT count(*)::int INTO n FROM ins;

  RETURN COALESCE(n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_enqueue_notification_outbox(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_enqueue_notification_outbox(uuid) TO service_role;
