-- Mobile: fetch own Twitter campaign assignment with campaign + variant payload (authenticated).

CREATE OR REPLACE FUNCTION public.twitter_campaign_get_assignment(p_assignment_id uuid)
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
  v RECORD;
  v_actionable boolean := false;
  v_reason text := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_assignment_id IS NULL THEN
    RAISE EXCEPTION 'invalid_assignment_id';
  END IF;

  SELECT
    t.id,
    t.user_id,
    t.campaign_id,
    t.wave_id,
    t.variant_id,
    t.status AS assignment_status,
    t.assigned_at
  INTO a
  FROM public.twitter_campaign_user_assignments t
  WHERE t.id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment_not_found';
  END IF;

  IF a.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT
    tc.id,
    tc.title,
    tc.type,
    tc.status AS campaign_status,
    tc.description
  INTO c
  FROM public.twitter_campaigns tc
  WHERE tc.id = a.campaign_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'campaign_not_found';
  END IF;

  SELECT
    v.id,
    v.variant_index,
    v.text,
    v.image_url,
    v.tweet_url,
    v.note
  INTO v
  FROM public.twitter_campaign_variants v
  WHERE v.id = a.variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'variant_not_found';
  END IF;

  IF a.assignment_status = 'cancelled' THEN
    v_actionable := false;
    v_reason := 'assignment_cancelled';
  ELSIF c.campaign_status = 'cancelled' THEN
    v_actionable := false;
    v_reason := 'campaign_cancelled';
  ELSIF c.campaign_status = 'paused' THEN
    v_actionable := false;
    v_reason := 'campaign_paused';
  ELSIF c.campaign_status <> 'published' THEN
    v_actionable := false;
    v_reason := 'campaign_not_active';
  ELSE
    v_actionable := true;
    v_reason := NULL;
  END IF;

  RETURN jsonb_build_object(
    'assignment_id', a.id,
    'assignment_status', a.assignment_status,
    'assigned_at', a.assigned_at,
    'campaign_id', c.id,
    'campaign_title', c.title,
    'campaign_status', c.campaign_status,
    'campaign_type', c.type,
    'campaign_description', c.description,
    'wave_id', a.wave_id,
    'variant_id', v.id,
    'variant_index', v.variant_index,
    'tweet_text', v.text,
    'image_url', v.image_url,
    'tweet_url', v.tweet_url,
    'note', v.note,
    'actionable', v_actionable,
    'unavailable_reason', v_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_get_assignment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_get_assignment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_get_assignment(uuid) TO service_role;
