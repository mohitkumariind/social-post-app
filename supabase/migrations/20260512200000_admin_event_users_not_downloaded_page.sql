-- Event drilldown: profiles in RBAC scope for an event who never downloaded that event's posts.
-- Scope mirrors admin_campaign_analytics_not_downloaded_profiles + phone visibility (admin only).
-- Search + pagination are applied server-side in SQL.

CREATE OR REPLACE FUNCTION public.admin_event_users_not_downloaded_page(
  p_event_id uuid,
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
    SELECT
      GREATEST(COALESCE(p_offset, 0), 0)::int AS off,
      LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)::int AS lim
  ),
  candidates AS (
    SELECT
      pr.id AS user_id,
      pr.name::text AS uname,
      COALESCE(pr.state::text, '')::text AS state_label,
      COALESCE(
        NULLIF(btrim(COALESCE(g.name::text, '')), ''),
        CASE WHEN pr.group_id IS NOT NULL THEN '(' || pr.group_id::text || ')' ELSE '' END
      )::text AS group_label,
      (SELECT MAX(pd.created_at) FROM public.post_downloads pd WHERE pd.user_id = pr.id) AS last_active_at,
      CASE lower(trim(p_scope_mode))
        WHEN 'all' THEN pr.phone::text
        ELSE NULL::text
      END AS phone_out
    FROM public.profiles pr
    INNER JOIN public.events ev ON ev.id = p_event_id
    LEFT JOIN public.groups g ON g.id = pr.group_id
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
    AND NOT EXISTS (
      SELECT 1
      FROM public.post_downloads d
      INNER JOIN public.posts po ON po.id = d.post_id AND po.event_id = p_event_id
      WHERE d.user_id = pr.id
    )
    AND (
      p_search IS NULL
      OR length(btrim(p_search)) = 0
      OR pr.name ILIKE ('%' || btrim(p_search) || '%')
      OR pr.id::text ILIKE ('%' || btrim(p_search) || '%')
      OR (
        lower(trim(p_scope_mode)) = 'all'
        AND pr.phone IS NOT NULL
        AND pr.phone::text ILIKE ('%' || btrim(p_search) || '%')
      )
    )
  ),
  ordered AS (
    SELECT *
    FROM candidates c
    ORDER BY COALESCE(NULLIF(btrim(c.uname), ''), '—') ASC, c.user_id ASC
  ),
  counted AS (
    SELECT o.*, COUNT(*) OVER ()::bigint AS total_count
    FROM ordered o
  )
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT MAX(c2.total_count) FROM counted c2 LIMIT 1), 0),
    'rows', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'user_id', c.user_id,
            'name', COALESCE(NULLIF(btrim(c.uname), ''), '—'),
            'phone', to_jsonb(c.phone_out),
            'state', c.state_label,
            'group', COALESCE(c.group_label, ''),
            'last_active', to_jsonb(c.last_active_at)
          )
          ORDER BY COALESCE(NULLIF(btrim(c.uname), ''), '—') ASC, c.user_id ASC
        )
        FROM (
          SELECT *
          FROM counted c
          ORDER BY COALESCE(NULLIF(btrim(c.uname), ''), '—') ASC, c.user_id ASC
          LIMIT (SELECT lim FROM lim)
          OFFSET (SELECT off FROM lim)
        ) c
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.admin_event_users_not_downloaded_page(
  uuid,
  text,
  bigint[],
  uuid,
  bigint[],
  text[],
  text,
  integer,
  integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_event_users_not_downloaded_page(
  uuid,
  text,
  bigint[],
  uuid,
  bigint[],
  text[],
  text,
  integer,
  integer
) TO service_role;
