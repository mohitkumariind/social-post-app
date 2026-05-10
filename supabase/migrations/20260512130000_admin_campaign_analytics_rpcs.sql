-- Campaign dashboard analytics RPCs (SECURITY DEFINER).
-- Scope rules MUST stay aligned with socialbot/lib/admin/rbac.ts (getScopedFilters / sqlProfilesWhere / sqlEventsWhere).
-- Invoked only from SocialBot server (service role). NOT exposed to anon/authenticated clients.

CREATE OR REPLACE FUNCTION public.admin_campaign_analytics_total_points(
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
  INNER JOIN public.posts p ON p.id = d.post_id AND p.event_id IS NOT NULL
  INNER JOIN public.events ev ON ev.id = p.event_id
  INNER JOIN public.profiles pr ON pr.id = d.user_id
  WHERE d.created_at >= p_from
    AND d.created_at <= p_to
    AND (
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
    );
$$;

CREATE OR REPLACE FUNCTION public.admin_campaign_analytics_event_download_stats(
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[]
) RETURNS TABLE (event_id uuid, download_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT p.event_id, COUNT(*)::bigint AS download_count
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
  GROUP BY p.event_id;
$$;

CREATE OR REPLACE FUNCTION public.admin_campaign_analytics_not_downloaded_profiles(
  p_event_id uuid,
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[],
  p_limit int
) RETURNS TABLE (profile_id uuid, name text, phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  WITH lim AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 20000)::int AS n
  )
  SELECT pr.id AS profile_id, pr.name::text, pr.phone::text
  FROM public.profiles pr
  INNER JOIN public.events ev ON ev.id = p_event_id
  CROSS JOIN lim
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
  LIMIT (SELECT n FROM lim);
$$;

REVOKE ALL ON FUNCTION public.admin_campaign_analytics_total_points(
  timestamptz,
  timestamptz,
  text,
  bigint[],
  uuid,
  bigint[],
  text[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_campaign_analytics_total_points(
  timestamptz,
  timestamptz,
  text,
  bigint[],
  uuid,
  bigint[],
  text[]
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_campaign_analytics_event_download_stats(
  text,
  bigint[],
  uuid,
  bigint[],
  text[]
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_campaign_analytics_event_download_stats(
  text,
  bigint[],
  uuid,
  bigint[],
  text[]
) TO service_role;

REVOKE ALL ON FUNCTION public.admin_campaign_analytics_not_downloaded_profiles(
  uuid,
  text,
  bigint[],
  uuid,
  bigint[],
  text[],
  int
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_campaign_analytics_not_downloaded_profiles(
  uuid,
  text,
  bigint[],
  uuid,
  bigint[],
  text[],
  int
) TO service_role;
