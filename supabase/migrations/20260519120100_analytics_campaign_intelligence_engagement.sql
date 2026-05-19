-- Campaign Intelligence v3: engagement model (generated from v2 template).

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
    WHERE ev.dashboard_category IS NULL
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
    INNER JOIN public.events ev ON ev.id = p.event_id AND ev.dashboard_category IS NULL
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
  eng AS (
    SELECT p.event_id AS eid, COUNT(DISTINCT d.user_id)::bigint AS c
    FROM public.post_downloads d
    INNER JOIN public.posts p ON p.id = d.post_id AND p.event_id IS NOT NULL
    INNER JOIN public.events ev ON ev.id = p.event_id AND ev.dashboard_category IS NULL
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
  nb_sent AS (
    SELECT nb.event_id AS eid, COALESCE(SUM(nb.target_user_count), 0)::bigint AS sent
    FROM public.notification_broadcasts nb
    LEFT JOIN public.events evn ON evn.id = nb.event_id
    WHERE (p_notify_from IS NULL OR nb.created_at >= p_notify_from)
      AND (p_notify_to IS NULL OR nb.created_at <= p_notify_to)
      AND (
        nb.event_id IS NULL
        OR (
          evn.id IS NOT NULL
          AND evn.dashboard_category IS NULL
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
    GROUP BY nb.event_id
  ),
  nh_del AS (
    SELECT nb.event_id AS eid, COUNT(*)::bigint AS c
    FROM public.notifications_history nh
    INNER JOIN public.notification_broadcasts nb ON nb.id = nh.broadcast_id
    INNER JOIN public.profiles pr ON pr.id = nh.user_id
    LEFT JOIN public.events evn ON evn.id = nb.event_id
    WHERE nh.delivery_status = 'sent'
      AND (p_notify_from IS NULL OR nb.created_at >= p_notify_from)
      AND (p_notify_to IS NULL OR nb.created_at <= p_notify_to)
      AND (
        nb.event_id IS NULL
        OR (
          evn.id IS NOT NULL
          AND evn.dashboard_category IS NULL
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
    GROUP BY nb.event_id
  ),
  op AS (
    SELECT nb.event_id AS eid, COUNT(*)::bigint AS c
    FROM public.notification_open no
    INNER JOIN public.notification_broadcasts nb ON nb.id = no.broadcast_id
    INNER JOIN public.profiles pr ON pr.id = no.user_id
    LEFT JOIN public.events evn ON evn.id = nb.event_id
    WHERE (p_notify_from IS NULL OR nb.created_at >= p_notify_from)
      AND (p_notify_to IS NULL OR nb.created_at <= p_notify_to)
      AND (
        nb.event_id IS NULL
        OR (
          evn.id IS NOT NULL
          AND evn.dashboard_category IS NULL
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
    GROUP BY nb.event_id
  ),
  event_src AS (
    SELECT se.eid, se.etitle FROM scoped_events se
    UNION ALL
    SELECT NULL::uuid AS eid, 'Global'::text AS etitle
    WHERE p_event_id IS NULL
      AND (
        p_search IS NULL
        OR length(btrim(p_search)) = 0
        OR 'global' ILIKE ('%' || btrim(p_search) || '%')
      )
      AND (
        EXISTS (SELECT 1 FROM nb_sent ns WHERE ns.eid IS NULL AND ns.sent > 0)
        OR EXISTS (SELECT 1 FROM nh_del nd WHERE nd.eid IS NULL AND nd.c > 0)
        OR EXISTS (SELECT 1 FROM op oo WHERE oo.eid IS NULL AND oo.c > 0)
        OR EXISTS (SELECT 1 FROM dl dd WHERE dd.eid IS NULL AND dd.c > 0)
      )
  ),
  base AS (
    SELECT
      es.eid,
      CASE WHEN es.eid IS NULL THEN 'Global' ELSE es.etitle END AS etitle,
      COALESCE(dl.c, 0)::bigint AS total_downloads,
      COALESCE(eng.c, 0)::bigint AS engaged_users,
      COALESCE(ns.sent, 0)::bigint AS total_notifications_sent,
      COALESCE(nd.c, 0)::bigint AS total_notifications_delivered,
      COALESCE(opn.c, 0)::bigint AS total_notifications_opened,
      CASE
        WHEN es.eid IS NULL THEN 0::bigint
        ELSE (
          SELECT COUNT(*)::bigint
          FROM (
            SELECT DISTINCT nh.user_id AS uid
            FROM public.notifications_history nh
            INNER JOIN public.notification_broadcasts nb ON nb.id = nh.broadcast_id AND nb.event_id = es.eid
            INNER JOIN public.profiles pr_r ON pr_r.id = nh.user_id
            WHERE nh.delivery_status = 'sent'
              AND (p_notify_from IS NULL OR nb.created_at >= p_notify_from)
              AND (p_notify_to IS NULL OR nb.created_at <= p_notify_to)
              AND (
                CASE lower(trim(p_scope_mode))
                  WHEN 'all' THEN true
                  WHEN 'moderator' THEN
                    COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
                    AND pr_r.state_id IS NOT NULL AND pr_r.state_id = ANY (p_moderator_state_ids)
                  WHEN 'campaign_manager' THEN
                    COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
                    AND pr_r.group_id IS NOT NULL AND pr_r.group_id = ANY (p_cm_profile_group_ids)
                  ELSE false
                END
              )
              AND NOT EXISTS (
                SELECT 1 FROM public.post_downloads d2
                INNER JOIN public.posts p2 ON p2.id = d2.post_id AND p2.event_id = es.eid
                INNER JOIN public.events ev2 ON ev2.id = p2.event_id AND ev2.dashboard_category IS NULL
                WHERE d2.user_id = nh.user_id
                  AND (p_download_from IS NULL OR d2.created_at >= p_download_from)
                  AND (p_download_to IS NULL OR d2.created_at <= p_download_to)
              )
          ) rec
        )::bigint
      END AS not_downloaded_count
    FROM event_src es
    LEFT JOIN dl ON dl.eid IS NOT DISTINCT FROM es.eid
    LEFT JOIN eng ON eng.eid IS NOT DISTINCT FROM es.eid
    LEFT JOIN nb_sent ns ON ns.eid IS NOT DISTINCT FROM es.eid
    LEFT JOIN nh_del nd ON nd.eid IS NOT DISTINCT FROM es.eid
    LEFT JOIN op opn ON opn.eid IS NOT DISTINCT FROM es.eid
  ),
  with_rates AS (
    SELECT
      b.eid,
      b.etitle,
      b.total_downloads,
      b.engaged_users,
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
        WHEN (b.engaged_users + b.not_downloaded_count) > 0 THEN
          b.engaged_users::double precision
          / (b.engaged_users + b.not_downloaded_count)::double precision
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
            'engaged_users', wp.engaged_users,
            'total_notifications_sent', wp.total_notifications_sent,
            'total_notifications_delivered', wp.total_notifications_delivered,
            'total_notifications_opened', wp.total_notifications_opened,
            'not_downloaded_count', wp.not_downloaded_count,
            'open_rate', wp.open_rate,
            'download_rate', wp.download_rate
          )
          ORDER BY (wp.eid IS NULL) ASC, wp.etitle ASC, wp.eid ASC NULLS LAST
        )
        FROM (
          SELECT *
          FROM with_rates wr
          ORDER BY (wr.eid IS NULL) ASC, wr.etitle ASC, wr.eid ASC NULLS LAST
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
