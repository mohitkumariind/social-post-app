-- Reusable server-side campaign analytics for one bucket: event_id UUID or NULL ("global").
-- Same metric definitions as admin_campaign_intelligence_event_metrics v2 (122030).
-- Invoked only from SocialBot (service role).

ALTER TABLE public.notifications_history
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_history_delivery_status_whitelist'
  ) THEN
    ALTER TABLE public.notifications_history
      ADD CONSTRAINT notifications_history_delivery_status_whitelist
      CHECK (delivery_status IN ('pending', 'sent', 'failed_retryable', 'failed_permanent')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_history_broadcast_delivery
  ON public.notifications_history (broadcast_id, delivery_status, user_id)
  WHERE broadcast_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_get_campaign_analytics(
  p_event_id uuid,
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[],
  p_download_from timestamptz,
  p_download_to timestamptz,
  p_notify_from timestamptz,
  p_notify_to timestamptz
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  WITH guard AS (
    SELECT (
      p_event_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.events ev
        WHERE ev.id = p_event_id
          AND (
            CASE lower(trim(p_scope_mode))
              WHEN 'all' THEN true
              WHEN 'moderator' THEN
                COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
                AND ev.state_id IS NOT NULL
                AND cardinality(ev.state_id) > 0
                AND ev.state_id::bigint[] <@ p_moderator_state_ids
              WHEN 'campaign_manager' THEN
                COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
                AND p_cm_viewer IS NOT NULL
                AND (
                  ev.created_by = p_cm_viewer
                  OR (
                    ev.target_groups IS NOT NULL
                    AND cardinality(ev.target_groups) > 0
                    AND ev.target_groups && p_cm_event_group_text
                  )
                )
              ELSE false
            END
          )
      )
    ) AS allowed
  ),
  sent AS (
    SELECT CASE
      WHEN NOT (SELECT allowed FROM guard) THEN 0::bigint
      ELSE (
        SELECT COALESCE(SUM(nb.target_user_count), 0)::bigint
        FROM public.notification_broadcasts nb
        LEFT JOIN public.events evn ON evn.id = nb.event_id
        WHERE (nb.event_id IS NOT DISTINCT FROM p_event_id)
          AND (p_notify_from IS NULL OR nb.created_at >= p_notify_from)
          AND (p_notify_to IS NULL OR nb.created_at <= p_notify_to)
          AND (
            nb.event_id IS NULL
            OR (
              evn.id IS NOT NULL
              AND (
                CASE lower(trim(p_scope_mode))
                  WHEN 'all' THEN true
                  WHEN 'moderator' THEN
                    COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
                    AND evn.state_id IS NOT NULL
                    AND cardinality(evn.state_id) > 0
                    AND evn.state_id::bigint[] <@ p_moderator_state_ids
                  WHEN 'campaign_manager' THEN
                    COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
                    AND p_cm_viewer IS NOT NULL
                    AND (
                      evn.created_by = p_cm_viewer
                      OR (
                        evn.target_groups IS NOT NULL
                        AND cardinality(evn.target_groups) > 0
                        AND evn.target_groups && p_cm_event_group_text
                      )
                    )
                  ELSE false
                END
              )
            )
          )
      )
    END AS c
  ),
  delivered AS (
    SELECT CASE
      WHEN NOT (SELECT allowed FROM guard) THEN 0::bigint
      ELSE (
        SELECT COUNT(*)::bigint
        FROM public.notifications_history nh
        INNER JOIN public.notification_broadcasts nb ON nb.id = nh.broadcast_id
        INNER JOIN public.profiles pr ON pr.id = nh.user_id
        LEFT JOIN public.events evn ON evn.id = nb.event_id
        WHERE nh.delivery_status = 'sent'
          AND (nb.event_id IS NOT DISTINCT FROM p_event_id)
          AND (p_notify_from IS NULL OR nb.created_at >= p_notify_from)
          AND (p_notify_to IS NULL OR nb.created_at <= p_notify_to)
          AND (
            nb.event_id IS NULL
            OR (
              evn.id IS NOT NULL
              AND (
                CASE lower(trim(p_scope_mode))
                  WHEN 'all' THEN true
                  WHEN 'moderator' THEN
                    COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
                    AND evn.state_id IS NOT NULL
                    AND cardinality(evn.state_id) > 0
                    AND evn.state_id::bigint[] <@ p_moderator_state_ids
                  WHEN 'campaign_manager' THEN
                    COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
                    AND p_cm_viewer IS NOT NULL
                    AND (
                      evn.created_by = p_cm_viewer
                      OR (
                        evn.target_groups IS NOT NULL
                        AND cardinality(evn.target_groups) > 0
                        AND evn.target_groups && p_cm_event_group_text
                      )
                    )
                  ELSE false
                END
              )
            )
          )
          AND (
            CASE lower(trim(p_scope_mode))
              WHEN 'all' THEN true
              WHEN 'moderator' THEN
                COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
                AND pr.state_id IS NOT NULL
                AND pr.state_id = ANY (p_moderator_state_ids)
              WHEN 'campaign_manager' THEN
                COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
                AND p_cm_viewer IS NOT NULL
                AND pr.group_id IS NOT NULL
                AND pr.group_id = ANY (p_cm_profile_group_ids)
              ELSE false
            END
          )
      )
    END AS c
  ),
  opened AS (
    SELECT CASE
      WHEN NOT (SELECT allowed FROM guard) THEN 0::bigint
      ELSE (
        SELECT COUNT(*)::bigint
        FROM public.notification_open no
        INNER JOIN public.notification_broadcasts nb ON nb.id = no.broadcast_id
        INNER JOIN public.profiles pr ON pr.id = no.user_id
        LEFT JOIN public.events evn ON evn.id = nb.event_id
        WHERE (nb.event_id IS NOT DISTINCT FROM p_event_id)
          AND (p_notify_from IS NULL OR nb.created_at >= p_notify_from)
          AND (p_notify_to IS NULL OR nb.created_at <= p_notify_to)
          AND (
            nb.event_id IS NULL
            OR (
              evn.id IS NOT NULL
              AND (
                CASE lower(trim(p_scope_mode))
                  WHEN 'all' THEN true
                  WHEN 'moderator' THEN
                    COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
                    AND evn.state_id IS NOT NULL
                    AND cardinality(evn.state_id) > 0
                    AND evn.state_id::bigint[] <@ p_moderator_state_ids
                  WHEN 'campaign_manager' THEN
                    COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
                    AND p_cm_viewer IS NOT NULL
                    AND (
                      evn.created_by = p_cm_viewer
                      OR (
                        evn.target_groups IS NOT NULL
                        AND cardinality(evn.target_groups) > 0
                        AND evn.target_groups && p_cm_event_group_text
                      )
                    )
                  ELSE false
                END
              )
            )
          )
          AND (
            CASE lower(trim(p_scope_mode))
              WHEN 'all' THEN true
              WHEN 'moderator' THEN
                COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
                AND pr.state_id IS NOT NULL
                AND pr.state_id = ANY (p_moderator_state_ids)
              WHEN 'campaign_manager' THEN
                COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
                AND p_cm_viewer IS NOT NULL
                AND pr.group_id IS NOT NULL
                AND pr.group_id = ANY (p_cm_profile_group_ids)
              ELSE false
            END
          )
      )
    END AS c
  ),
  downloads AS (
    SELECT CASE
      WHEN NOT (SELECT allowed FROM guard) THEN 0::bigint
      ELSE (
        SELECT COUNT(*)::bigint
        FROM public.post_downloads d
        INNER JOIN public.posts p ON p.id = d.post_id
        LEFT JOIN public.events ev ON ev.id = p.event_id
        INNER JOIN public.profiles pr ON pr.id = d.user_id
        WHERE (p.event_id IS NOT DISTINCT FROM p_event_id)
          AND (p_download_from IS NULL OR d.created_at >= p_download_from)
          AND (p_download_to IS NULL OR d.created_at <= p_download_to)
          AND (
            CASE lower(trim(p_scope_mode))
              WHEN 'all' THEN true
              WHEN 'moderator' THEN
                COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
                AND pr.state_id IS NOT NULL
                AND pr.state_id = ANY (p_moderator_state_ids)
                AND (
                  p.event_id IS NULL
                  OR (
                    ev.state_id IS NOT NULL
                    AND cardinality(ev.state_id) > 0
                    AND ev.state_id::bigint[] <@ p_moderator_state_ids
                  )
                )
              WHEN 'campaign_manager' THEN
                COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
                AND p_cm_viewer IS NOT NULL
                AND pr.group_id IS NOT NULL
                AND pr.group_id = ANY (p_cm_profile_group_ids)
                AND (
                  p.event_id IS NULL
                  OR (
                    ev.created_by = p_cm_viewer
                    OR (
                      ev.target_groups IS NOT NULL
                      AND cardinality(ev.target_groups) > 0
                      AND ev.target_groups && p_cm_event_group_text
                    )
                  )
                )
              ELSE false
            END
          )
      )
    END AS c
  ),
  not_downloaded AS (
    SELECT CASE
      WHEN NOT (SELECT allowed FROM guard) OR p_event_id IS NULL THEN 0::bigint
      ELSE (
        SELECT COUNT(*)::bigint
        FROM public.profiles pr2
        WHERE (
          CASE lower(trim(p_scope_mode))
            WHEN 'all' THEN true
            WHEN 'moderator' THEN
              COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
              AND pr2.state_id IS NOT NULL
              AND pr2.state_id = ANY (p_moderator_state_ids)
            WHEN 'campaign_manager' THEN
              COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
              AND pr2.group_id IS NOT NULL
              AND pr2.group_id = ANY (p_cm_profile_group_ids)
            ELSE false
          END
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.post_downloads d2
          INNER JOIN public.posts p2 ON p2.id = d2.post_id AND p2.event_id = p_event_id
          WHERE d2.user_id = pr2.id
        )
      )
    END AS c
  )
  SELECT jsonb_build_object(
    'event_id', p_event_id,
    'sent', (SELECT c FROM sent),
    'delivered', (SELECT c FROM delivered),
    'opened', (SELECT c FROM opened),
    'downloads', (SELECT c FROM downloads),
    'not_downloaded', (SELECT c FROM not_downloaded),
    'open_rate',
    CASE
      WHEN (SELECT c FROM delivered) > 0 THEN
        (SELECT c FROM opened)::double precision / (SELECT c FROM delivered)::double precision
      ELSE NULL::double precision
    END
  );
$$;

REVOKE ALL ON FUNCTION public.admin_get_campaign_analytics(
  uuid,
  text,
  bigint[],
  uuid,
  bigint[],
  text[],
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_campaign_analytics(
  uuid,
  text,
  bigint[],
  uuid,
  bigint[],
  text[],
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) TO service_role;
