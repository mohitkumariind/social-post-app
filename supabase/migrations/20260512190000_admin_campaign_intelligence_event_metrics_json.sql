-- Campaign Intelligence RPC: return { total, rows } as jsonb for server-side pagination
-- while preserving RBAC semantics from 20260512180000.

DROP FUNCTION IF EXISTS public.admin_campaign_intelligence_event_metrics(
  text,
  bigint[],
  uuid,
  bigint[],
  text[],
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz,
  text
);

CREATE OR REPLACE FUNCTION public.admin_campaign_intelligence_event_metrics(
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[],
  p_download_from timestamptz,
  p_download_to timestamptz,
  p_notify_from timestamptz,
  p_notify_to timestamptz,
  p_search text,
  p_event_id uuid DEFAULT NULL,
  p_limit integer DEFAULT NULL,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  WITH scoped_events AS (
    SELECT
      ev.id AS eid,
      COALESCE(
        NULLIF(btrim(COALESCE(ev.title, '')), ''),
        NULLIF(btrim(COALESCE(ev.name::text, '')), ''),
        '—'
      )::text AS etitle
    FROM public.events ev
    WHERE (
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
    AND (
      p_search IS NULL
      OR length(btrim(p_search)) = 0
      OR (
        COALESCE(ev.title, '') || ' ' || COALESCE(ev.name::text, '')
      ) ILIKE ('%' || btrim(p_search) || '%')
    )
    AND (p_event_id IS NULL OR ev.id = p_event_id)
  ),
  dl AS (
    SELECT p.event_id AS eid, COUNT(*)::bigint AS c
    FROM public.post_downloads d
    INNER JOIN public.posts p ON p.id = d.post_id AND p.event_id IS NOT NULL
    INNER JOIN public.events ev ON ev.id = p.event_id
    INNER JOIN public.profiles pr ON pr.id = d.user_id
    WHERE (
      CASE lower(trim(p_scope_mode))
        WHEN 'all' THEN true
        WHEN 'moderator' THEN
          COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
          AND pr.state_id IS NOT NULL
          AND pr.state_id = ANY (p_moderator_state_ids)
          AND ev.state_id IS NOT NULL
          AND cardinality(ev.state_id) > 0
          AND ev.state_id::bigint[] <@ p_moderator_state_ids
        WHEN 'campaign_manager' THEN
          COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
          AND p_cm_viewer IS NOT NULL
          AND pr.group_id IS NOT NULL
          AND pr.group_id = ANY (p_cm_profile_group_ids)
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
    AND (p_download_from IS NULL OR d.created_at >= p_download_from)
    AND (p_download_to IS NULL OR d.created_at <= p_download_to)
    GROUP BY p.event_id
  ),
  nb AS (
    SELECT
      nb.event_id AS eid,
      COALESCE(SUM(nb.sent_count), 0)::bigint AS sent,
      COALESCE(SUM(nb.delivered_count), 0)::bigint AS delivered,
      COALESCE(SUM(nb.opened_count), 0)::bigint AS opened
    FROM public.notification_broadcasts nb
    INNER JOIN public.events evn ON evn.id = nb.event_id
    WHERE nb.event_id IS NOT NULL
      AND (p_notify_from IS NULL OR nb.created_at >= p_notify_from)
      AND (p_notify_to IS NULL OR nb.created_at <= p_notify_to)
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
    GROUP BY nb.event_id
  ),
  base AS (
    SELECT
      se.eid,
      se.etitle,
      COALESCE(dl.c, 0)::bigint AS total_downloads,
      COALESCE(nb.sent, 0)::bigint AS total_notifications_sent,
      COALESCE(nb.delivered, 0)::bigint AS total_notifications_delivered,
      COALESCE(nb.opened, 0)::bigint AS total_notifications_opened,
      (
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
          INNER JOIN public.posts p2 ON p2.id = d2.post_id AND p2.event_id = se.eid
          WHERE d2.user_id = pr2.id
        )
      )::bigint AS not_downloaded_count
    FROM scoped_events se
    LEFT JOIN dl ON dl.eid = se.eid
    LEFT JOIN nb ON nb.eid = se.eid
  ),
  with_rates AS (
    SELECT
      b.eid,
      b.etitle,
      b.total_downloads,
      b.total_notifications_sent,
      b.total_notifications_delivered,
      b.total_notifications_opened,
      b.not_downloaded_count,
      CASE
        WHEN b.total_notifications_delivered > 0 THEN
          b.total_notifications_opened::double precision / b.total_notifications_delivered::double precision
        ELSE NULL::double precision
      END AS open_rate,
      CASE
        WHEN (b.total_downloads + b.not_downloaded_count) > 0 THEN
          b.total_downloads::double precision
          / (b.total_downloads + b.not_downloaded_count)::double precision
        ELSE NULL::double precision
      END AS download_rate
    FROM base b
  )
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT COUNT(*)::bigint FROM with_rates), 0),
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'event_id', wp.eid,
            'event_title', wp.etitle,
            'total_downloads', wp.total_downloads,
            'total_notifications_sent', wp.total_notifications_sent,
            'total_notifications_delivered', wp.total_notifications_delivered,
            'total_notifications_opened', wp.total_notifications_opened,
            'not_downloaded_count', wp.not_downloaded_count,
            'open_rate', wp.open_rate,
            'download_rate', wp.download_rate
          )
          ORDER BY wp.etitle ASC, wp.eid ASC
        )
        FROM (
          SELECT *
          FROM with_rates wr
          ORDER BY wr.etitle ASC, wr.eid ASC
          LIMIT (CASE WHEN p_limit IS NULL THEN NULL ELSE p_limit END)
          OFFSET GREATEST(COALESCE(p_offset, 0), 0)
        ) wp
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.admin_campaign_intelligence_event_metrics(
  text,
  bigint[],
  uuid,
  bigint[],
  text[],
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  uuid,
  integer,
  integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_campaign_intelligence_event_metrics(
  text,
  bigint[],
  uuid,
  bigint[],
  text[],
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  uuid,
  integer,
  integer
) TO service_role;
