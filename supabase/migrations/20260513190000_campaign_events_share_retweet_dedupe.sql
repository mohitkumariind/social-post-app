-- Release hardening: DB-level dedupe for share_clicked / retweet_clicked (race-safe).
-- Removes duplicate rows (if any), adds partial unique indexes, updates track_event to use ON CONFLICT.

-- ---------------------------------------------------------------------------
-- 1) Remove duplicate engagement rows (keep earliest by created_at, id)
-- ---------------------------------------------------------------------------
DELETE FROM public.campaign_events ce
WHERE ce.id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY assignment_id
             ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM public.campaign_events
    WHERE event_type = 'share_clicked'
  ) x
  WHERE x.rn > 1
);

DELETE FROM public.campaign_events ce
WHERE ce.id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY assignment_id
             ORDER BY created_at ASC, id ASC
           ) AS rn
    FROM public.campaign_events
    WHERE event_type = 'retweet_clicked'
  ) x
  WHERE x.rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_events_uq_assignment_share_clicked
  ON public.campaign_events (assignment_id)
  WHERE event_type = 'share_clicked';

CREATE UNIQUE INDEX IF NOT EXISTS campaign_events_uq_assignment_retweet_clicked
  ON public.campaign_events (assignment_id)
  WHERE event_type = 'retweet_clicked';

-- ---------------------------------------------------------------------------
-- track_event: ON CONFLICT dedupe for share/retweet; award idempotent points
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

  IF p_event_type = 'notification_opened' THEN
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
  ELSIF p_event_type = 'share_clicked' THEN
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
      'share_clicked',
      COALESCE(p_metadata, '{}'::jsonb)
    )
    ON CONFLICT (assignment_id) WHERE (event_type = 'share_clicked')
    DO NOTHING
    RETURNING id INTO new_id;
    IF new_id IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'deduped', true, 'event', p_event_type);
    END IF;
  ELSIF p_event_type = 'retweet_clicked' THEN
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
      'retweet_clicked',
      COALESCE(p_metadata, '{}'::jsonb)
    )
    ON CONFLICT (assignment_id) WHERE (event_type = 'retweet_clicked')
    DO NOTHING
    RETURNING id INTO new_id;
    IF new_id IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'deduped', true, 'event', p_event_type);
    END IF;
  END IF;

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
