-- Phase 2: unique engaged users per event (alongside raw download counts).
-- KPI buckets remain raw COUNT(post_downloads) only.

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
      COUNT(pd.id)::bigint AS downloads,
      COUNT(DISTINCT (pd.user_id, COALESCE(p.event_id, pd.event_id)))::bigint AS engaged_users
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
        'downloads', c.downloads,
        'engaged_users', c.engaged_users
      ) ORDER BY c.downloads DESC, c.title ASC, c.event_id ASC)
      FROM (
        SELECT * FROM counted c
        ORDER BY c.downloads DESC, c.title ASC, c.event_id ASC
        LIMIT (SELECT lim FROM lim) OFFSET (SELECT off FROM lim)
      ) c
    ), '[]'::jsonb)
  );
$$;

NOTIFY pgrst, 'reload schema';
