-- State + party filters for unified admin analytics (KPI strip + 7-day event metrics).

DROP FUNCTION IF EXISTS public.admin_engaged_users_kpis(text, bigint[], uuid, bigint[], text[]);
DROP FUNCTION IF EXISTS public.admin_event_metrics_7d_page(
  text, bigint[], uuid, bigint[], text[], text, integer, integer
);

CREATE OR REPLACE FUNCTION public.admin_analytics_metric_scoped(
  p_from timestamptz,
  p_to timestamptz,
  p_metric text,
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[],
  p_filter_state_id bigint,
  p_filter_party text
) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    CASE lower(trim(COALESCE(p_metric, '')))
      WHEN 'engaged_users' THEN COUNT(DISTINCT d.user_id)
      ELSE COUNT(*)
    END::bigint
  FROM public.post_downloads d
  INNER JOIN public.profiles pr ON pr.id = d.user_id
  WHERE d.created_at >= p_from
    AND d.created_at <= p_to
    AND (p_filter_state_id IS NULL OR pr.state_id = p_filter_state_id)
    AND (
      p_filter_party IS NULL
      OR length(btrim(p_filter_party)) = 0
      OR pr.party = btrim(p_filter_party)
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
    );
$$;

CREATE OR REPLACE FUNCTION public.admin_engaged_users_kpis(
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[],
  p_filter_state_id bigint DEFAULT NULL,
  p_filter_party text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_now timestamptz := now();
  v_start_today timestamptz := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_start_yesterday timestamptz := v_start_today - interval '1 day';
  v_end_yesterday timestamptz := v_start_today - interval '1 microsecond';
  v_start_7d timestamptz := v_now - interval '7 days';
  v_start_30d timestamptz := v_now - interval '30 days';
  v_start_current_month timestamptz :=
    date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_start_last_month timestamptz :=
    (date_trunc('month', (v_now AT TIME ZONE 'UTC')::timestamp) - interval '1 month') AT TIME ZONE 'UTC';
  v_end_last_month timestamptz := v_start_current_month - interval '1 microsecond';
  v_epoch timestamptz := '2000-01-01T00:00:00Z'::timestamptz;
BEGIN
  RETURN jsonb_build_object(
    'engaged_users', jsonb_build_object(
      'today',
        public.admin_analytics_metric_scoped(
          v_start_today, v_now, 'engaged_users',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'yesterday',
        public.admin_analytics_metric_scoped(
          v_start_yesterday, v_end_yesterday, 'engaged_users',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'last7_days',
        public.admin_analytics_metric_scoped(
          v_start_7d, v_now, 'engaged_users',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'last_30_days',
        public.admin_analytics_metric_scoped(
          v_start_30d, v_now, 'engaged_users',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'current_month',
        public.admin_analytics_metric_scoped(
          v_start_current_month, v_now, 'engaged_users',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'last_month',
        public.admin_analytics_metric_scoped(
          v_start_last_month, v_end_last_month, 'engaged_users',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'all_time',
        public.admin_analytics_metric_scoped(
          v_epoch, v_now, 'engaged_users',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        )
    ),
    'raw_downloads', jsonb_build_object(
      'today',
        public.admin_analytics_metric_scoped(
          v_start_today, v_now, 'raw_downloads',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'yesterday',
        public.admin_analytics_metric_scoped(
          v_start_yesterday, v_end_yesterday, 'raw_downloads',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'last7_days',
        public.admin_analytics_metric_scoped(
          v_start_7d, v_now, 'raw_downloads',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'last_30_days',
        public.admin_analytics_metric_scoped(
          v_start_30d, v_now, 'raw_downloads',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'current_month',
        public.admin_analytics_metric_scoped(
          v_start_current_month, v_now, 'raw_downloads',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'last_month',
        public.admin_analytics_metric_scoped(
          v_start_last_month, v_end_last_month, 'raw_downloads',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        ),
      'all_time',
        public.admin_analytics_metric_scoped(
          v_epoch, v_now, 'raw_downloads',
          p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text,
          p_filter_state_id, p_filter_party
        )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_event_metrics_7d_page(
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[],
  p_search text,
  p_offset integer,
  p_limit integer,
  p_filter_state_id bigint DEFAULT NULL,
  p_filter_party text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  WITH lim AS (
    SELECT GREATEST(COALESCE(p_offset, 0), 0)::int AS off, LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)::int AS lim
  ),
  v_window AS (
    SELECT now() - interval '7 days' AS start_at, now() AS end_at
  ),
  eligible_events AS (
    SELECT
      e.id AS event_id,
      COALESCE(
        NULLIF(btrim(COALESCE(e.title, '')), ''),
        NULLIF(btrim(COALESCE(e.name::text, '')), ''),
        '—'
      )::text AS title
    FROM public.events e
    WHERE e.dashboard_category IS NULL
      AND (
        p_filter_state_id IS NULL
        OR (
          e.state_id IS NOT NULL
          AND cardinality(e.state_id) > 0
          AND p_filter_state_id = ANY (e.state_id::bigint[])
        )
      )
      AND (
        CASE lower(trim(p_scope_mode))
          WHEN 'all' THEN true
          WHEN 'moderator' THEN
            COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
            AND e.state_id IS NOT NULL
            AND cardinality(e.state_id) > 0
            AND e.state_id::bigint[] <@ p_moderator_state_ids
          WHEN 'campaign_manager' THEN
            COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
            AND p_cm_viewer IS NOT NULL
            AND (
              e.created_by = p_cm_viewer
              OR (
                e.target_groups IS NOT NULL
                AND cardinality(e.target_groups) > 0
                AND e.target_groups && p_cm_event_group_text
              )
            )
          ELSE false
        END
      )
      AND (
        p_search IS NULL
        OR length(btrim(p_search)) = 0
        OR (COALESCE(e.title, '') || ' ' || COALESCE(e.name::text, '')) ILIKE ('%' || btrim(p_search) || '%')
      )
  ),
  posts_by_event AS (
    SELECT p.event_id, COUNT(p.id)::bigint AS posts
    FROM public.posts p
    INNER JOIN eligible_events ee ON ee.event_id = p.event_id
    GROUP BY p.event_id
  ),
  downloads_7d AS (
    SELECT
      COALESCE(p.event_id, pd.event_id) AS event_id,
      COUNT(pd.id)::bigint AS raw_downloads,
      COUNT(DISTINCT pd.user_id)::bigint AS engaged_users
    FROM public.post_downloads pd
    INNER JOIN public.posts p ON p.id = pd.post_id
    INNER JOIN eligible_events ee ON ee.event_id = COALESCE(p.event_id, pd.event_id)
    INNER JOIN public.profiles pr ON pr.id = pd.user_id
    CROSS JOIN v_window w
    WHERE pd.created_at >= w.start_at
      AND pd.created_at <= w.end_at
      AND (p_filter_state_id IS NULL OR pr.state_id = p_filter_state_id)
      AND (
        p_filter_party IS NULL
        OR length(btrim(p_filter_party)) = 0
        OR pr.party = btrim(p_filter_party)
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
    GROUP BY COALESCE(p.event_id, pd.event_id)
  ),
  agg AS (
    SELECT
      ee.event_id,
      ee.title,
      COALESCE(pb.posts, 0)::bigint AS posts,
      COALESCE(d.raw_downloads, 0)::bigint AS raw_downloads,
      COALESCE(d.engaged_users, 0)::bigint AS engaged_users
    FROM eligible_events ee
    LEFT JOIN posts_by_event pb ON pb.event_id = ee.event_id
    LEFT JOIN downloads_7d d ON d.event_id = ee.event_id
    WHERE COALESCE(pb.posts, 0) > 0 OR COALESCE(d.raw_downloads, 0) > 0
  ),
  counted AS (
    SELECT a.*, COUNT(*) OVER ()::bigint AS total_count
    FROM agg a
  )
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT MAX(c2.total_count) FROM counted c2 LIMIT 1), 0),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'event_id', c.event_id,
        'title', c.title,
        'posts', c.posts,
        'raw_downloads', c.raw_downloads,
        'engaged_users', c.engaged_users
      ) ORDER BY c.raw_downloads DESC, c.title ASC, c.event_id ASC)
      FROM (
        SELECT * FROM counted c
        ORDER BY c.raw_downloads DESC, c.title ASC, c.event_id ASC
        LIMIT (SELECT lim FROM lim) OFFSET (SELECT off FROM lim)
      ) c
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_analytics_metric_scoped(
  timestamptz, timestamptz, text, text, bigint[], uuid, bigint[], text[], bigint, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_analytics_metric_scoped(
  timestamptz, timestamptz, text, text, bigint[], uuid, bigint[], text[], bigint, text
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_engaged_users_kpis(
  text, bigint[], uuid, bigint[], text[], bigint, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_engaged_users_kpis(
  text, bigint[], uuid, bigint[], text[], bigint, text
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_event_metrics_7d_page(
  text, bigint[], uuid, bigint[], text[], text, integer, integer, bigint, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_event_metrics_7d_page(
  text, bigint[], uuid, bigint[], text[], text, integer, integer, bigint, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
