-- Phase 1: raw download analytics only (COUNT post_downloads by created_at; event table via posts → events).
-- Excludes events.dashboard_category IS NOT NULL. No notifications, engagement, or dedupe.

CREATE OR REPLACE FUNCTION public.admin_raw_download_count_scoped(
  p_from timestamptz,
  p_to timestamptz,
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[]
) RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COUNT(*)::bigint
  FROM public.post_downloads d
  WHERE d.created_at >= p_from
    AND d.created_at <= p_to
    AND (
      CASE lower(trim(p_scope_mode))
        WHEN 'all' THEN true
        WHEN 'moderator' THEN
          EXISTS (
            SELECT 1
            FROM public.profiles pr
            WHERE pr.id = d.user_id
              AND COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
              AND pr.state_id IS NOT NULL
              AND pr.state_id = ANY (p_moderator_state_ids)
          )
        WHEN 'campaign_manager' THEN
          EXISTS (
            SELECT 1
            FROM public.profiles pr
            WHERE pr.id = d.user_id
              AND COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
              AND p_cm_viewer IS NOT NULL
              AND pr.group_id IS NOT NULL
              AND pr.group_id = ANY (p_cm_profile_group_ids)
          )
        ELSE false
      END
    );
$$;

CREATE OR REPLACE FUNCTION public.admin_raw_download_kpis(
  p_range_from timestamptz,
  p_range_to timestamptz,
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[]
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
  v_prev_month_start timestamptz :=
    (date_trunc('month', (v_now AT TIME ZONE 'UTC')::timestamp) - interval '1 month') AT TIME ZONE 'UTC';
  v_prev_month_end timestamptz :=
    date_trunc('month', (v_now AT TIME ZONE 'UTC')::timestamp) AT TIME ZONE 'UTC' - interval '1 microsecond';
  v_epoch timestamptz := '2000-01-01T00:00:00Z'::timestamptz;
BEGIN
  RETURN jsonb_build_object(
    'today',
      public.admin_raw_download_count_scoped(
        v_start_today, v_now,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'yesterday',
      public.admin_raw_download_count_scoped(
        v_start_yesterday, v_end_yesterday,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'last7_days',
      public.admin_raw_download_count_scoped(
        v_start_7d, v_now,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'last_month',
      public.admin_raw_download_count_scoped(
        v_prev_month_start, v_prev_month_end,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'all_time',
      public.admin_raw_download_count_scoped(
        v_epoch, v_now,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'range_count',
      CASE
        WHEN p_range_from IS NOT NULL AND p_range_to IS NOT NULL THEN
          public.admin_raw_download_count_scoped(
            p_range_from, p_range_to,
            p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
          )
        ELSE NULL::bigint
      END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_raw_download_events_page(
  p_from timestamptz,
  p_to timestamptz,
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[],
  p_search text,
  p_offset integer,
  p_limit integer
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
  agg AS (
    SELECT
      e.id AS event_id,
      COALESCE(
        NULLIF(btrim(COALESCE(e.title, '')), ''),
        NULLIF(btrim(COALESCE(e.name::text, '')), ''),
        '—'
      )::text AS title,
      COUNT(pd.id)::bigint AS downloads
    FROM public.post_downloads pd
    INNER JOIN public.posts p ON p.id = pd.post_id
    INNER JOIN public.events e ON e.id = COALESCE(p.event_id, pd.event_id) AND e.dashboard_category IS NULL
    INNER JOIN public.profiles pr ON pr.id = pd.user_id
    WHERE pd.created_at >= p_from
      AND pd.created_at <= p_to
      AND (
        CASE lower(trim(p_scope_mode))
          WHEN 'all' THEN true
          WHEN 'moderator' THEN
            COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
            AND pr.state_id IS NOT NULL
            AND pr.state_id = ANY (p_moderator_state_ids)
            AND e.state_id IS NOT NULL
            AND cardinality(e.state_id) > 0
            AND e.state_id::bigint[] <@ p_moderator_state_ids
          WHEN 'campaign_manager' THEN
            COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0
            AND p_cm_viewer IS NOT NULL
            AND pr.group_id IS NOT NULL
            AND pr.group_id = ANY (p_cm_profile_group_ids)
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
        OR (
          COALESCE(e.title, '') || ' ' || COALESCE(e.name::text, '')
        ) ILIKE ('%' || btrim(p_search) || '%')
      )
    GROUP BY e.id, e.title, e.name
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
        'downloads', c.downloads
      ) ORDER BY c.downloads DESC, c.title ASC, c.event_id ASC)
      FROM (
        SELECT * FROM counted c
        ORDER BY c.downloads DESC, c.title ASC, c.event_id ASC
        LIMIT (SELECT lim FROM lim) OFFSET (SELECT off FROM lim)
      ) c
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_raw_download_count_scoped(
  timestamptz, timestamptz, text, bigint[], uuid, bigint[], text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_raw_download_count_scoped(
  timestamptz, timestamptz, text, bigint[], uuid, bigint[], text[]
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_raw_download_kpis(
  timestamptz, timestamptz, text, bigint[], uuid, bigint[], text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_raw_download_kpis(
  timestamptz, timestamptz, text, bigint[], uuid, bigint[], text[]
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_raw_download_events_page(
  timestamptz, timestamptz, text, bigint[], uuid, bigint[], text[], text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_raw_download_events_page(
  timestamptz, timestamptz, text, bigint[], uuid, bigint[], text[], text, integer, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';
