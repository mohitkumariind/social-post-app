-- Phase 7: Twitter campaign analytics — event log keyed by assignment_id.

CREATE TABLE IF NOT EXISTS public.campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.twitter_campaigns (id) ON DELETE CASCADE,
  wave_id uuid NOT NULL REFERENCES public.twitter_campaign_waves (id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.twitter_campaign_user_assignments (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_events_event_type_check
    CHECK (
      event_type IN (
        'assignment_created',
        'notification_sent',
        'notification_opened',
        'share_clicked',
        'retweet_clicked'
      )
    )
);

-- One row per assignment for lifecycle singletons (idempotent worker + trigger).
CREATE UNIQUE INDEX IF NOT EXISTS campaign_events_uq_assignment_notification_sent
  ON public.campaign_events (assignment_id)
  WHERE event_type = 'notification_sent';

CREATE UNIQUE INDEX IF NOT EXISTS campaign_events_uq_assignment_created
  ON public.campaign_events (assignment_id)
  WHERE event_type = 'assignment_created';

CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_type
  ON public.campaign_events (campaign_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_events_wave_type
  ON public.campaign_events (wave_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_events_assignment
  ON public.campaign_events (assignment_id, event_type, created_at DESC);

ALTER TABLE public.campaign_events ENABLE ROW LEVEL SECURITY;

-- No direct client access; writers use SECURITY DEFINER RPCs / service role.
REVOKE ALL ON public.campaign_events FROM PUBLIC;
GRANT SELECT, INSERT ON public.campaign_events TO service_role;

-- ---------------------------------------------------------------------------
-- assignment_created: mirror each new row in twitter_campaign_user_assignments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_campaign_events_on_assignment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  INSERT INTO public.campaign_events (
    user_id,
    campaign_id,
    wave_id,
    assignment_id,
    event_type,
    metadata
  )
  VALUES (
    NEW.user_id,
    NEW.campaign_id,
    NEW.wave_id,
    NEW.id,
    'assignment_created',
    '{}'::jsonb
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_twitter_campaign_assignment_campaign_event ON public.twitter_campaign_user_assignments;
CREATE TRIGGER trg_twitter_campaign_assignment_campaign_event
AFTER INSERT ON public.twitter_campaign_user_assignments
FOR EACH ROW
EXECUTE FUNCTION public.trg_campaign_events_on_assignment_insert();

-- ---------------------------------------------------------------------------
-- Authenticated users: engagement events only (assignment must belong to caller)
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
  new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_event_type NOT IN ('notification_opened', 'share_clicked', 'retweet_clicked') THEN
    RAISE EXCEPTION 'invalid_event_type';
  END IF;

  SELECT id, user_id, campaign_id, wave_id
  INTO a
  FROM public.twitter_campaign_user_assignments
  WHERE id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment_not_found';
  END IF;

  IF a.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden';
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

  RETURN jsonb_build_object('ok', true, 'id', new_id);
END;
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_track_event(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_track_event(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_track_event(uuid, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Service role: idempotent notification_sent (delivery worker)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.twitter_campaign_record_notification_sent(
  p_assignment_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  a RECORD;
  new_id uuid;
BEGIN
  SELECT id, user_id, campaign_id, wave_id
  INTO a
  FROM public.twitter_campaign_user_assignments
  WHERE id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment_not_found';
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
    'notification_sent',
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO new_id;

  IF new_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'inserted', false);
  END IF;

  RETURN jsonb_build_object('ok', true, 'inserted', true, 'id', new_id);
END;
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_record_notification_sent(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_record_notification_sent(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Admin analytics bundle (service role / server only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.twitter_campaign_admin_analytics(p_campaign_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  WITH totals AS (
    SELECT
      (SELECT COUNT(*)::int FROM public.twitter_campaign_user_assignments a WHERE a.campaign_id = p_campaign_id) AS assignments,
      (SELECT COUNT(*)::int FROM public.campaign_events e WHERE e.campaign_id = p_campaign_id AND e.event_type = 'notification_sent') AS notifications_sent,
      (SELECT COUNT(DISTINCT e.assignment_id)::int FROM public.campaign_events e WHERE e.campaign_id = p_campaign_id AND e.event_type = 'notification_opened') AS opens_distinct,
      (SELECT COUNT(DISTINCT e.assignment_id)::int FROM public.campaign_events e WHERE e.campaign_id = p_campaign_id AND e.event_type = 'share_clicked') AS share_clicks_distinct,
      (SELECT COUNT(DISTINCT e.assignment_id)::int FROM public.campaign_events e WHERE e.campaign_id = p_campaign_id AND e.event_type = 'retweet_clicked') AS retweet_clicks_distinct,
      (SELECT COUNT(DISTINCT e.assignment_id)::int FROM public.campaign_events e WHERE e.campaign_id = p_campaign_id AND e.event_type IN ('share_clicked', 'retweet_clicked')) AS action_participation_distinct
  ),
  wave_rows AS (
    SELECT
      w.id AS wave_id,
      w.wave_index,
      w.scheduled_at,
      w.status AS wave_status,
      (SELECT COUNT(*)::int FROM public.twitter_campaign_user_assignments a WHERE a.wave_id = w.id) AS assignments,
      (SELECT COUNT(*)::int FROM public.campaign_events e WHERE e.wave_id = w.id AND e.event_type = 'notification_sent') AS notifications_sent,
      (SELECT COUNT(DISTINCT e.assignment_id)::int FROM public.campaign_events e WHERE e.wave_id = w.id AND e.event_type = 'notification_opened') AS opens_distinct,
      (SELECT COUNT(DISTINCT e.assignment_id)::int FROM public.campaign_events e WHERE e.wave_id = w.id AND e.event_type = 'share_clicked') AS share_clicks_distinct,
      (SELECT COUNT(DISTINCT e.assignment_id)::int FROM public.campaign_events e WHERE e.wave_id = w.id AND e.event_type = 'retweet_clicked') AS retweet_clicks_distinct,
      (SELECT COUNT(DISTINCT e.assignment_id)::int FROM public.campaign_events e WHERE e.wave_id = w.id AND e.event_type IN ('share_clicked', 'retweet_clicked')) AS action_participation_distinct
    FROM public.twitter_campaign_waves w
    WHERE w.campaign_id = p_campaign_id
  )
  SELECT jsonb_build_object(
    'campaign_id', p_campaign_id,
    'summary', (
      SELECT jsonb_build_object(
        'total_assignments', t.assignments,
        'total_notifications', t.notifications_sent,
        'opens_distinct', t.opens_distinct,
        'share_clicks_distinct', t.share_clicks_distinct,
        'retweet_clicks_distinct', t.retweet_clicks_distinct,
        'clicks_distinct', t.action_participation_distinct,
        'participation_rate',
          CASE
            WHEN t.assignments > 0 THEN round((t.action_participation_distinct::numeric / t.assignments::numeric), 6)
            ELSE NULL
          END,
        'open_rate',
          CASE
            WHEN t.notifications_sent > 0 THEN round((t.opens_distinct::numeric / t.notifications_sent::numeric), 6)
            ELSE NULL
          END
      )
      FROM totals t
    ),
    'waves', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'wave_id', wr.wave_id,
            'wave_index', wr.wave_index,
            'scheduled_at', wr.scheduled_at,
            'wave_status', wr.wave_status,
            'assignments', wr.assignments,
            'notifications_sent', wr.notifications_sent,
            'opens_distinct', wr.opens_distinct,
            'share_clicks_distinct', wr.share_clicks_distinct,
            'retweet_clicks_distinct', wr.retweet_clicks_distinct,
            'clicks_distinct', wr.action_participation_distinct,
            'participation_rate',
              CASE
                WHEN wr.assignments > 0 THEN round((wr.action_participation_distinct::numeric / wr.assignments::numeric), 6)
                ELSE NULL
              END
          )
          ORDER BY wr.wave_index
        )
        FROM wave_rows wr
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_admin_analytics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_admin_analytics(uuid) TO service_role;
