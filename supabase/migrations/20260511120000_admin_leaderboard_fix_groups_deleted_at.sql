-- Fix admin leaderboard RPC when public.groups has no deleted_at (older DBs / partial migrations).
-- Replaces function body only: join groups by id without soft-delete filter.

CREATE OR REPLACE FUNCTION public.admin_leaderboard_page(
  p_mode text,
  p_moderator_state_ids bigint[],
  p_cm_group_ids bigint[],
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_search text,
  p_filter_state_id bigint,
  p_filter_party text,
  p_filter_group_id bigint,
  p_include_phone boolean,
  p_offset int,
  p_limit int
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  m text := lower(trim(p_mode));
  off int := GREATEST(COALESCE(p_offset, 0), 0);
  lim int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  s text := NULLIF(trim(COALESCE(p_search, '')), '');
  fp text := NULLIF(trim(COALESCE(p_filter_party, '')), '');
BEGIN
  IF m NOT IN ('admin', 'moderator', 'campaign_manager') THEN
    RAISE EXCEPTION 'invalid admin leaderboard mode' USING ERRCODE = '22023';
  END IF;

  RETURN (
    WITH downloads AS (
      SELECT pd.user_id AS uid, COUNT(*)::bigint AS pts, MAX(pd.created_at) AS last_at
      FROM public.post_downloads pd
      WHERE pd.created_at >= p_date_from
        AND pd.created_at <= p_date_to
      GROUP BY pd.user_id
    ),
    base AS (
      SELECT
        pr.id AS profile_id,
        COALESCE(NULLIF(btrim(pr.name::text), ''), '—')::text AS uname,
        COALESCE(pr.state::text, '')::text AS state,
        COALESCE(pr.party::text, '')::text AS party,
        pr.group_id AS group_id,
        COALESCE(g.name::text, '')::text AS group_name,
        d.pts AS points,
        d.last_at AS last_active,
        COALESCE(pr.phone::text, '')::text AS phone
      FROM downloads d
      INNER JOIN public.profiles pr ON pr.id = d.uid
      LEFT JOIN public.groups g ON g.id = pr.group_id
      WHERE
        CASE m
          WHEN 'admin' THEN true
          WHEN 'moderator' THEN pr.state_id IS NOT NULL AND pr.state_id = ANY(COALESCE(p_moderator_state_ids, '{}'::bigint[]))
          WHEN 'campaign_manager' THEN
            COALESCE(cardinality(p_cm_group_ids), 0) > 0
            AND (
              (pr.group_id IS NOT NULL AND pr.group_id = ANY(p_cm_group_ids))
              OR EXISTS (
                SELECT 1
                FROM public.group_memberships gm
                WHERE gm.user_id = pr.id
                  AND gm.group_id = ANY(p_cm_group_ids)
              )
            )
          ELSE false
        END
        AND (p_filter_state_id IS NULL OR pr.state_id = p_filter_state_id)
        AND (fp IS NULL OR pr.party = fp)
        AND (p_filter_group_id IS NULL OR pr.group_id = p_filter_group_id)
        AND (
          s IS NULL
          OR pr.name ILIKE ('%' || s || '%')
          OR pr.phone ILIKE ('%' || s || '%')
        )
    ),
    kpis AS (
      SELECT
        COUNT(*)::bigint AS total_users,
        COALESCE(SUM(b.points), 0)::bigint AS total_points
      FROM base b
    ),
    top_state AS (
      SELECT b.state AS nm, SUM(b.points)::bigint AS pts
      FROM base b
      WHERE btrim(b.state) <> ''
      GROUP BY b.state
      ORDER BY pts DESC NULLS LAST, b.state ASC
      LIMIT 1
    ),
    top_grp AS (
      SELECT
        COALESCE(NULLIF(btrim(MAX(COALESCE(g.name::text, ''))), ''), '(' || b.group_id::text || ')') AS nm,
        SUM(b.points)::bigint AS pts
      FROM base b
      LEFT JOIN public.groups g ON g.id = b.group_id
      WHERE b.group_id IS NOT NULL
      GROUP BY b.group_id
      ORDER BY pts DESC NULLS LAST, b.group_id ASC
      LIMIT 1
    ),
    total_cte AS (
      SELECT COUNT(*)::bigint AS c FROM base
    ),
    paged AS (
      SELECT
        (ROW_NUMBER() OVER (ORDER BY b.points DESC, b.profile_id DESC))::bigint AS rank,
        b.profile_id,
        b.uname,
        b.state,
        b.party,
        b.group_id,
        b.group_name,
        b.points,
        b.last_active,
        b.phone
      FROM base b
      ORDER BY b.points DESC, b.profile_id DESC
      OFFSET off
      LIMIT lim
    )
    SELECT jsonb_build_object(
      'rows',
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'rank', p.rank,
              'profile_id', p.profile_id,
              'name', p.uname,
              'state', p.state,
              'party', p.party,
              'group_id', p.group_id,
              'group_name', p.group_name,
              'points', p.points,
              'last_active', p.last_active,
              'phone', CASE WHEN p_include_phone THEN p.phone ELSE NULL END
            )
            ORDER BY p.rank ASC
          )
          FROM paged p
        ),
        '[]'::jsonb
      ),
      'kpis',
      jsonb_build_object(
        'total_users', (SELECT total_users FROM kpis),
        'total_points', (SELECT total_points FROM kpis),
        'top_state_name', (SELECT nm FROM top_state LIMIT 1),
        'top_state_points', COALESCE((SELECT pts FROM top_state LIMIT 1), 0),
        'top_group_name', (SELECT nm FROM top_grp LIMIT 1),
        'top_group_points', COALESCE((SELECT pts FROM top_grp LIMIT 1), 0),
        'avg_points_per_user',
        CASE
          WHEN (SELECT total_users FROM kpis) > 0
          THEN round((SELECT total_points::numeric FROM kpis) / (SELECT total_users::numeric FROM kpis), 2)
          ELSE 0::numeric
        END
      ),
      'total_matching', (SELECT c FROM total_cte)
    )
  );
END;
$$;
