-- Engagement-based analytics: raw downloads + unique users per event; exclude dashboard_category events;
-- not-downloaded = notification recipients minus engaged users (date-scoped); leaderboard = distinct (user, event).

-- ---------------------------------------------------------------------------
-- KPI raw download totals (exclude dashboard_category events)
-- ---------------------------------------------------------------------------
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
  INNER JOIN public.events ev ON ev.id = p.event_id AND ev.dashboard_category IS NULL
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

-- ---------------------------------------------------------------------------
-- Leaderboard: 1 point per distinct (user_id, event_id) engagement in range
-- ---------------------------------------------------------------------------
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
    WITH engagement_pairs AS (
      SELECT DISTINCT pd.user_id AS uid, p.event_id AS eid
      FROM public.post_downloads pd
      INNER JOIN public.posts p ON p.id = pd.post_id AND p.event_id IS NOT NULL
      INNER JOIN public.events ev ON ev.id = p.event_id AND ev.dashboard_category IS NULL
      WHERE pd.created_at >= p_date_from
        AND pd.created_at <= p_date_to
    ),
    downloads AS (
      SELECT
        ep.uid,
        COUNT(*)::bigint AS pts,
        (
          SELECT MAX(d.created_at)
          FROM public.post_downloads d
          INNER JOIN public.posts po ON po.id = d.post_id AND po.event_id IS NOT NULL
          INNER JOIN public.events ev2 ON ev2.id = po.event_id AND ev2.dashboard_category IS NULL
          WHERE d.user_id = ep.uid
            AND d.created_at >= p_date_from
            AND d.created_at <= p_date_to
        ) AS last_at
      FROM engagement_pairs ep
      GROUP BY ep.uid
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
                SELECT 1 FROM public.group_memberships gm
                WHERE gm.user_id = pr.id AND gm.group_id = ANY(p_cm_group_ids)
              )
            )
          ELSE false
        END
        AND (p_filter_state_id IS NULL OR pr.state_id = p_filter_state_id)
        AND (fp IS NULL OR pr.party = fp)
        AND (p_filter_group_id IS NULL OR pr.group_id = p_filter_group_id)
        AND (s IS NULL OR pr.name ILIKE ('%' || s || '%') OR pr.phone ILIKE ('%' || s || '%'))
    ),
    kpis AS (
      SELECT COUNT(*)::bigint AS total_users, COALESCE(SUM(b.points), 0)::bigint AS total_points FROM base b
    ),
    top_state AS (
      SELECT b.state AS nm, SUM(b.points)::bigint AS pts FROM base b WHERE btrim(b.state) <> '' GROUP BY b.state ORDER BY pts DESC NULLS LAST, b.state ASC LIMIT 1
    ),
    top_grp AS (
      SELECT COALESCE(NULLIF(btrim(MAX(COALESCE(g.name::text, ''))), ''), '(' || b.group_id::text || ')') AS nm, SUM(b.points)::bigint AS pts
      FROM base b LEFT JOIN public.groups g ON g.id = b.group_id
      WHERE b.group_id IS NOT NULL GROUP BY b.group_id ORDER BY pts DESC NULLS LAST, b.group_id ASC LIMIT 1
    ),
    total_cte AS (SELECT COUNT(*)::bigint AS c FROM base),
    paged AS (
      SELECT (ROW_NUMBER() OVER (ORDER BY b.points DESC, b.profile_id DESC))::bigint AS rank, b.*
      FROM base b ORDER BY b.points DESC, b.profile_id DESC LIMIT lim OFFSET off
    )
    SELECT jsonb_build_object(
      'kpis', jsonb_build_object(
        'total_users', (SELECT total_users FROM kpis),
        'total_points', (SELECT total_points FROM kpis),
        'top_state', COALESCE((SELECT jsonb_build_object('name', nm, 'points', pts) FROM top_state), 'null'::jsonb),
        'top_group', COALESCE((SELECT jsonb_build_object('name', nm, 'points', pts) FROM top_grp), 'null'::jsonb)
      ),
      'total', (SELECT c FROM total_cte),
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM paged p), '[]'::jsonb)
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Mobile leaderboard: distinct (user, event) engagements (campaign events only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_leaderboard(p_scope text, p_limit int)
RETURNS TABLE (
  leader_rank bigint,
  profile_id uuid,
  display_name text,
  avatar_url text,
  instagram text,
  points bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  sc text := lower(trim(p_scope));
  lim int;
BEGIN
  IF sc NOT IN ('state', 'national') THEN
    RAISE EXCEPTION 'invalid leaderboard scope' USING ERRCODE = '22023';
  END IF;
  IF sc = 'state' THEN lim := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  ELSE lim := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  END IF;

  RETURN QUERY
  WITH viewer AS (
    SELECT p.party_id AS vid_party, p.state_id AS vid_state FROM public.profiles p WHERE p.id = auth.uid()
  ),
  engagement_pairs AS (
    SELECT DISTINCT d.user_id AS uid, p.event_id AS eid
    FROM public.post_downloads d
    INNER JOIN public.posts p ON p.id = d.post_id AND p.event_id IS NOT NULL
    INNER JOIN public.events ev ON ev.id = p.event_id AND ev.dashboard_category IS NULL
  ),
  agg AS (
    SELECT ep.uid, COUNT(*)::bigint AS pts FROM engagement_pairs ep GROUP BY ep.uid
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY a.pts DESC NULLS LAST, pr.name ASC)::bigint,
    pr.id, COALESCE(NULLIF(btrim(pr.name::text), ''), 'User')::text,
    COALESCE(pr.avatar_url::text, '')::text, COALESCE(pr.instagram::text, '')::text, a.pts
  FROM public.profiles pr
  INNER JOIN agg a ON a.uid = pr.id
  CROSS JOIN viewer v
  WHERE (sc = 'national' AND v.vid_party IS NOT NULL AND pr.party_id = v.vid_party)
     OR (sc = 'state' AND v.vid_party IS NOT NULL AND v.vid_state IS NOT NULL AND pr.party_id = v.vid_party AND pr.state_id = v.vid_state)
  ORDER BY a.pts DESC, pr.name ASC
  LIMIT lim;
END;
$$;

-- ---------------------------------------------------------------------------
-- Resend cooldown: return user_ids allowed to receive another event notification
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_filter_notification_resend_allowed(
  p_event_id uuid,
  p_user_ids uuid[],
  p_cooldown_seconds int DEFAULT 3600
) RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(array_agg(u.uid ORDER BY u.uid), '{}'::uuid[])
  FROM unnest(COALESCE(p_user_ids, '{}'::uuid[])) AS u(uid)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.notifications_history nh
    INNER JOIN public.notification_broadcasts nb ON nb.id = nh.broadcast_id
    WHERE nh.user_id = u.uid
      AND nb.event_id = p_event_id
      AND nh.created_at > (now() - make_interval(secs => GREATEST(COALESCE(p_cooldown_seconds, 3600), 0)))
  );
$$;

REVOKE ALL ON FUNCTION public.admin_filter_notification_resend_allowed(uuid, uuid[], int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_filter_notification_resend_allowed(uuid, uuid[], int) TO service_role;

-- ---------------------------------------------------------------------------
-- Not-downloaded drilldown: notification recipients minus engaged users (date-scoped)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_event_users_not_downloaded_page(
  uuid, text, bigint[], uuid, bigint[], text[], text, integer, integer
);

CREATE OR REPLACE FUNCTION public.admin_event_users_not_downloaded_page(
  p_event_id uuid,
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
  candidates AS (
    SELECT DISTINCT ON (pr.id)
      pr.id AS user_id,
      pr.name::text AS uname,
      COALESCE(pr.state::text, '')::text AS state_label,
      COALESCE(
        NULLIF(btrim(COALESCE(g.name::text, '')), ''),
        CASE WHEN pr.group_id IS NOT NULL THEN '(' || pr.group_id::text || ')' ELSE '' END
      )::text AS group_label,
      (SELECT MAX(pd.created_at) FROM public.post_downloads pd WHERE pd.user_id = pr.id) AS last_active_at,
      CASE lower(trim(p_scope_mode)) WHEN 'all' THEN pr.phone::text ELSE NULL::text END AS phone_out
    FROM public.notifications_history nh
    INNER JOIN public.notification_broadcasts nb ON nb.id = nh.broadcast_id AND nb.event_id = p_event_id
    INNER JOIN public.profiles pr ON pr.id = nh.user_id
    INNER JOIN public.events ev ON ev.id = p_event_id AND ev.dashboard_category IS NULL
    LEFT JOIN public.groups g ON g.id = pr.group_id
    WHERE nh.delivery_status = 'sent'
      AND (p_notify_from IS NULL OR nb.created_at >= p_notify_from)
      AND (p_notify_to IS NULL OR nb.created_at <= p_notify_to)
      AND (
        CASE lower(trim(p_scope_mode))
          WHEN 'all' THEN true
          WHEN 'moderator' THEN
            COALESCE(array_length(p_moderator_state_ids, 1), 0) > 0
            AND pr.state_id IS NOT NULL AND pr.state_id = ANY (p_moderator_state_ids)
            AND ev.state_id IS NOT NULL AND cardinality(ev.state_id) > 0
            AND ev.state_id::bigint[] <@ p_moderator_state_ids
          WHEN 'campaign_manager' THEN
            COALESCE(array_length(p_cm_profile_group_ids, 1), 0) > 0 AND p_cm_viewer IS NOT NULL
            AND pr.group_id IS NOT NULL AND pr.group_id = ANY (p_cm_profile_group_ids)
            AND (ev.created_by = p_cm_viewer OR (ev.target_groups IS NOT NULL AND cardinality(ev.target_groups) > 0 AND ev.target_groups && p_cm_event_group_text))
          ELSE false
        END
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.post_downloads d
        INNER JOIN public.posts po ON po.id = d.post_id AND po.event_id = p_event_id
        INNER JOIN public.events ev2 ON ev2.id = po.event_id AND ev2.dashboard_category IS NULL
        WHERE d.user_id = pr.id
          AND (p_download_from IS NULL OR d.created_at >= p_download_from)
          AND (p_download_to IS NULL OR d.created_at <= p_download_to)
      )
      AND (
        p_search IS NULL OR length(btrim(p_search)) = 0
        OR pr.name ILIKE ('%' || btrim(p_search) || '%')
        OR pr.id::text ILIKE ('%' || btrim(p_search) || '%')
        OR (lower(trim(p_scope_mode)) = 'all' AND pr.phone IS NOT NULL AND pr.phone::text ILIKE ('%' || btrim(p_search) || '%'))
      )
    ORDER BY pr.id
  ),
  ordered AS (SELECT * FROM candidates c ORDER BY COALESCE(NULLIF(btrim(c.uname), ''), '—') ASC, c.user_id ASC),
  counted AS (SELECT o.*, COUNT(*) OVER ()::bigint AS total_count FROM ordered o)
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT MAX(c2.total_count) FROM counted c2 LIMIT 1), 0),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', c.user_id, 'name', COALESCE(NULLIF(btrim(c.uname), ''), '—'),
        'phone', to_jsonb(c.phone_out), 'state', c.state_label, 'group', COALESCE(c.group_label, ''),
        'last_active', to_jsonb(c.last_active_at)
      ) ORDER BY COALESCE(NULLIF(btrim(c.uname), ''), '—') ASC, c.user_id ASC)
      FROM (SELECT * FROM counted c ORDER BY COALESCE(NULLIF(btrim(c.uname), ''), '—') ASC, c.user_id ASC
            LIMIT (SELECT lim FROM lim) OFFSET (SELECT off FROM lim)) c
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_event_users_not_downloaded_page(
  uuid, text, bigint[], uuid, bigint[], text[], timestamptz, timestamptz, timestamptz, timestamptz, text, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_event_users_not_downloaded_page(
  uuid, text, bigint[], uuid, bigint[], text[], timestamptz, timestamptz, timestamptz, timestamptz, text, integer, integer
) TO service_role;
