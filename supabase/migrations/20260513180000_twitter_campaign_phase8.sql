-- Phase 8: Twitter campaigns — points ledger, pause/resume, caps, admin ops, delivery health.

-- ---------------------------------------------------------------------------
-- Campaign operational columns (caps + configurable point amounts)
-- ---------------------------------------------------------------------------
ALTER TABLE public.twitter_campaigns
  ADD COLUMN IF NOT EXISTS max_push_per_user_per_day int NOT NULL DEFAULT 20
    CONSTRAINT twitter_campaigns_max_push_per_user_per_day_check CHECK (max_push_per_user_per_day >= 0);

ALTER TABLE public.twitter_campaigns
  ADD COLUMN IF NOT EXISTS points_share int NOT NULL DEFAULT 10
    CONSTRAINT twitter_campaigns_points_share_check CHECK (points_share >= 0);

ALTER TABLE public.twitter_campaigns
  ADD COLUMN IF NOT EXISTS points_retweet int NOT NULL DEFAULT 10
    CONSTRAINT twitter_campaigns_points_retweet_check CHECK (points_retweet >= 0);

ALTER TABLE public.twitter_campaigns
  ADD COLUMN IF NOT EXISTS points_participation int NOT NULL DEFAULT 15
    CONSTRAINT twitter_campaigns_points_participation_check CHECK (points_participation >= 0);

ALTER TABLE public.twitter_campaigns
  DROP CONSTRAINT IF EXISTS twitter_campaigns_status_check;

ALTER TABLE public.twitter_campaigns
  ADD CONSTRAINT twitter_campaigns_status_check
  CHECK (status IN ('draft', 'published', 'paused', 'cancelled'));

-- ---------------------------------------------------------------------------
-- point_ledger: idempotent rewards per assignment + reason
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.point_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.twitter_campaigns (id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.twitter_campaign_user_assignments (id) ON DELETE CASCADE,
  points int NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT point_ledger_points_positive CHECK (points > 0),
  CONSTRAINT point_ledger_reason_check
    CHECK (reason IN ('share_click', 'retweet_click', 'campaign_participation'))
);

CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_uq_assignment_share_click
  ON public.point_ledger (assignment_id)
  WHERE reason = 'share_click';

CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_uq_assignment_retweet_click
  ON public.point_ledger (assignment_id)
  WHERE reason = 'retweet_click';

CREATE UNIQUE INDEX IF NOT EXISTS point_ledger_uq_assignment_campaign_participation
  ON public.point_ledger (assignment_id)
  WHERE reason = 'campaign_participation';

CREATE INDEX IF NOT EXISTS idx_point_ledger_user_campaign
  ON public.point_ledger (user_id, campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_point_ledger_campaign
  ON public.point_ledger (campaign_id, created_at DESC);

ALTER TABLE public.point_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.point_ledger FROM PUBLIC;
GRANT SELECT, INSERT ON public.point_ledger TO service_role;

-- ---------------------------------------------------------------------------
-- Enqueue: only active published campaigns + per-user daily send cap (UTC day)
-- ---------------------------------------------------------------------------
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
      AND c.status = 'published'
      AND (
        SELECT COUNT(*)::int
        FROM public.notification_outbox o
        WHERE o.user_id = a.user_id
          AND o.campaign_id = a.campaign_id
          AND o.status = 'sent'
          AND o.sent_at IS NOT NULL
          AND (o.sent_at AT TIME ZONE 'UTC')::date = (timezone('utc', now()))::date
      ) < c.max_push_per_user_per_day
    ON CONFLICT (assignment_id) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::int INTO n FROM ins;

  RETURN COALESCE(n, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_enqueue_notification_outbox(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_enqueue_notification_outbox(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- track_event: dedupe share/retweet events; award idempotent points
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.twitter_campaign_track_event(
  p_assignment_id uuid,
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  a RECORD;
  c RECORD;
  new_id uuid;
  dup boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_event_type NOT IN ('notification_opened', 'share_clicked', 'retweet_clicked') THEN
    RAISE EXCEPTION 'invalid_event_type';
  END IF;

  SELECT t.id, t.user_id, t.campaign_id, t.wave_id
  INTO a
  FROM public.twitter_campaign_user_assignments t
  WHERE t.id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment_not_found';
  END IF;

  IF a.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF p_event_type = 'share_clicked' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.campaign_events e
      WHERE e.assignment_id = p_assignment_id AND e.event_type = 'share_clicked'
    ) INTO dup;
    IF dup THEN
      RETURN jsonb_build_object('ok', true, 'deduped', true, 'event', p_event_type);
    END IF;
  ELSIF p_event_type = 'retweet_clicked' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.campaign_events e
      WHERE e.assignment_id = p_assignment_id AND e.event_type = 'retweet_clicked'
    ) INTO dup;
    IF dup THEN
      RETURN jsonb_build_object('ok', true, 'deduped', true, 'event', p_event_type);
    END IF;
  END IF;

  INSERT INTO public.campaign_events (
    user_id,
    campaign_id,
    wave_id,
    assignment_id,
    event_type,
    metadata
  )
  VALUES (
    a.user_id,
    a.campaign_id,
    a.wave_id,
    p_assignment_id,
    p_event_type,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO new_id;

  IF p_event_type = 'share_clicked' OR p_event_type = 'retweet_clicked' THEN
    SELECT tc.type, tc.points_share, tc.points_retweet, tc.points_participation
    INTO c
    FROM public.twitter_campaigns tc
    WHERE tc.id = a.campaign_id;

    IF FOUND THEN
      IF p_event_type = 'share_clicked' AND c.type = 'tweet' AND c.points_share > 0 THEN
        INSERT INTO public.point_ledger (user_id, campaign_id, assignment_id, points, reason)
        VALUES (a.user_id, a.campaign_id, p_assignment_id, c.points_share, 'share_click')
        ON CONFLICT DO NOTHING;
      END IF;

      IF p_event_type = 'retweet_clicked' AND c.type = 'retweet' AND c.points_retweet > 0 THEN
        INSERT INTO public.point_ledger (user_id, campaign_id, assignment_id, points, reason)
        VALUES (a.user_id, a.campaign_id, p_assignment_id, c.points_retweet, 'retweet_click')
        ON CONFLICT DO NOTHING;
      END IF;

      IF
        (p_event_type = 'share_clicked' AND c.type = 'tweet' AND c.points_participation > 0)
        OR (p_event_type = 'retweet_clicked' AND c.type = 'retweet' AND c.points_participation > 0)
      THEN
        INSERT INTO public.point_ledger (user_id, campaign_id, assignment_id, points, reason)
        VALUES (a.user_id, a.campaign_id, p_assignment_id, c.points_participation, 'campaign_participation')
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', new_id);
END;
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_track_event(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_track_event(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_track_event(uuid, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Admin / worker RPCs (service role from SocialBot only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.twitter_campaign_pause(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  cur text;
BEGIN
  SELECT status INTO cur FROM public.twitter_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF cur IS DISTINCT FROM 'published' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', cur);
  END IF;
  UPDATE public.twitter_campaigns SET status = 'paused', updated_at = now() WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'status', 'paused');
END;
$$;

CREATE OR REPLACE FUNCTION public.twitter_campaign_resume(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  cur text;
BEGIN
  SELECT status INTO cur FROM public.twitter_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF cur IS DISTINCT FROM 'paused' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_state', 'status', cur);
  END IF;
  UPDATE public.twitter_campaigns SET status = 'published', updated_at = now() WHERE id = p_campaign_id;
  RETURN jsonb_build_object('ok', true, 'status', 'published');
END;
$$;

CREATE OR REPLACE FUNCTION public.twitter_campaign_cancel_remaining_waves(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  nw int;
  no int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.twitter_campaigns c WHERE c.id = p_campaign_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  UPDATE public.twitter_campaign_waves w
  SET
    status = 'cancelled',
    locked_at = NULL,
    locked_by = NULL,
    lock_token = NULL,
    last_error = 'admin_cancel_remaining_waves'
  WHERE w.campaign_id = p_campaign_id
    AND w.status IN ('pending', 'running');
  GET DIAGNOSTICS nw = ROW_COUNT;

  UPDATE public.notification_outbox o
  SET
    status = 'cancelled',
    locked_at = NULL,
    locked_by = NULL,
    lock_token = NULL,
    last_error = 'admin_cancel_remaining_waves'
  WHERE o.campaign_id = p_campaign_id
    AND o.status IN ('pending', 'failed', 'processing');
  GET DIAGNOSTICS no = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'waves_cancelled', nw, 'outbox_cancelled', no);
END;
$$;

CREATE OR REPLACE FUNCTION public.twitter_campaign_retry_failed_notifications(p_campaign_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  n int;
BEGIN
  UPDATE public.notification_outbox o
  SET
    status = 'pending',
    next_retry_at = now(),
    attempts = 0,
    last_error = NULL,
    locked_at = NULL,
    locked_by = NULL,
    lock_token = NULL
  WHERE o.status = 'failed'
    AND (p_campaign_id IS NULL OR o.campaign_id = p_campaign_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'reset_rows', n);
END;
$$;

CREATE OR REPLACE FUNCTION public.twitter_campaign_delivery_health(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  lease_stale timestamptz := now() - interval '10 minutes';
  j jsonb;
BEGIN
  SELECT jsonb_build_object(
    'campaign_id', p_campaign_id,
    'notification_outbox', (
      SELECT COALESCE(jsonb_object_agg(x.status, x.cnt), '{}'::jsonb)
      FROM (
        SELECT o.status, COUNT(*)::int AS cnt
        FROM public.notification_outbox o
        WHERE (p_campaign_id IS NULL OR o.campaign_id = p_campaign_id)
        GROUP BY o.status
      ) x
    ),
    'outbox_stale_processing', (
      SELECT COUNT(*)::int
      FROM public.notification_outbox o
      WHERE o.status = 'processing'
        AND (p_campaign_id IS NULL OR o.campaign_id = p_campaign_id)
        AND (o.locked_at IS NULL OR o.locked_at < lease_stale)
    ),
    'waves_by_status', (
      SELECT COALESCE(jsonb_object_agg(w.status, w.cnt), '{}'::jsonb)
      FROM (
        SELECT tw.status, COUNT(*)::int AS cnt
        FROM public.twitter_campaign_waves tw
        WHERE (p_campaign_id IS NULL OR tw.campaign_id = p_campaign_id)
        GROUP BY tw.status
      ) w
    ),
    'point_ledger_rows', (
      SELECT COUNT(*)::int FROM public.point_ledger pl
      WHERE p_campaign_id IS NULL OR pl.campaign_id = p_campaign_id
    )
  ) INTO j;
  RETURN j;
END;
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_pause(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.twitter_campaign_resume(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.twitter_campaign_cancel_remaining_waves(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.twitter_campaign_retry_failed_notifications(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.twitter_campaign_delivery_health(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.twitter_campaign_pause(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_resume(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_cancel_remaining_waves(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_retry_failed_notifications(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_delivery_health(uuid) TO service_role;
