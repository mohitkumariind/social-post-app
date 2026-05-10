-- Dashboard reader security: RLS on posts/events + canonical RPCs + shared visibility helpers.
-- Aligns with mobile utils/visibility.ts and utils/lifecycle.ts (UTC window [start,end] inclusive).
-- Service role bypasses RLS (admin APIs / workers). Authenticated mobile uses RPC or RLS-filtered SELECT.

-- ---------------------------------------------------------------------------
-- Safe timestamp parsing for event lifecycle (malformed -> excluded).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_safe_timestamptz(p_input text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_input IS NULL OR btrim(p_input) = '' THEN
    RETURN NULL;
  END IF;
  RETURN p_input::timestamptz;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- profile_ids column -> text[] (global when empty; mirrors client toStrArr).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_profile_ids_to_text_array(j jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  out_arr text[] := ARRAY[]::text[];
BEGIN
  IF j IS NULL OR jsonb_typeof(j) = 'null' THEN
    RETURN ARRAY[]::text[];
  END IF;
  IF jsonb_typeof(j) = 'string' THEN
    IF length(trim(j #>> '{}')) = 0 THEN
      RETURN ARRAY[]::text[];
    END IF;
    RETURN ARRAY[trim(j #>> '{}')];
  END IF;
  IF jsonb_typeof(j) = 'array' THEN
    SELECT COALESCE(array_agg(trim(both FROM v)), ARRAY[]::text[])
    INTO out_arr
    FROM jsonb_array_elements_text(j) AS q(v);
    RETURN out_arr;
  END IF;
  RETURN ARRAY[]::text[];
END;
$$;

-- ---------------------------------------------------------------------------
-- Core targeting match (global = all arrays empty; strict rules preserved).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_visibility_match(
  u_profile text,
  u_party bigint,
  u_state bigint,
  u_lok bigint,
  u_asm bigint,
  u_group bigint,
  c_party bigint[],
  c_state bigint[],
  c_lok bigint[],
  c_asm bigint[],
  c_grp bigint[],
  c_prof text[]
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  party_ids bigint[] := COALESCE(c_party, '{}');
  state_ids bigint[] := COALESCE(c_state, '{}');
  lok_ids bigint[] := COALESCE(c_lok, '{}');
  asm_ids bigint[] := COALESCE(c_asm, '{}');
  grp_ids bigint[] := COALESCE(c_grp, '{}');
  prof_ids text[] := COALESCE(c_prof, '{}');
  is_global boolean;
BEGIN
  IF u_profile IS NULL OR btrim(u_profile) = '' THEN
    RETURN false;
  END IF;
  IF u_party IS NULL OR u_state IS NULL THEN
    RETURN false;
  END IF;

  is_global :=
    cardinality(party_ids) = 0
    AND cardinality(state_ids) = 0
    AND cardinality(lok_ids) = 0
    AND cardinality(asm_ids) = 0
    AND cardinality(grp_ids) = 0
    AND cardinality(prof_ids) = 0;
  IF is_global THEN
    RETURN true;
  END IF;

  IF NOT (cardinality(state_ids) = 0 OR 0 = ANY (state_ids) OR u_state = ANY (state_ids)) THEN
    RETURN false;
  END IF;
  IF NOT (cardinality(party_ids) = 0 OR 0 = ANY (party_ids) OR u_party = ANY (party_ids)) THEN
    RETURN false;
  END IF;

  IF cardinality(lok_ids) > 0 AND NOT (0 = ANY (lok_ids)) THEN
    IF u_lok IS NULL OR NOT (u_lok = ANY (lok_ids)) THEN
      RETURN false;
    END IF;
  END IF;

  IF cardinality(asm_ids) > 0 AND NOT (0 = ANY (asm_ids)) THEN
    IF u_asm IS NULL OR NOT (u_asm = ANY (asm_ids)) THEN
      RETURN false;
    END IF;
  END IF;

  IF cardinality(grp_ids) > 0 THEN
    IF u_group IS NULL OR (NOT (0 = ANY (grp_ids)) AND NOT (u_group = ANY (grp_ids))) THEN
      RETURN false;
    END IF;
  END IF;

  IF cardinality(prof_ids) > 0 AND NOT (u_profile = ANY (prof_ids)) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Elevated roles: admin UI / ops (same coarse gate as typical Supabase admin clients).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_auth_is_elevated_editor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND COALESCE(p.role, 'user') IN ('admin', 'moderator', 'campaign_manager')
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level reader visibility (invoker: uses caller JWT + own profiles row).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_post_visible_to_me(r public.posts)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (r.is_video IS DISTINCT FROM true OR r.is_video IS NULL)
    AND r.status = 'published'
    AND r.deleted_at IS NULL
    AND (r.scheduled_at IS NULL OR r.scheduled_at <= now())
    AND EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE pr.id = auth.uid()
        AND pr.party_id IS NOT NULL
        AND pr.state_id IS NOT NULL
        AND public.dashboard_visibility_match(
          pr.id::text,
          pr.party_id::bigint,
          pr.state_id::bigint,
          pr.loksabha_id::bigint,
          pr.assembly_id::bigint,
          pr.group_id::bigint,
          COALESCE(r.party_id, '{}'::bigint[]),
          COALESCE(r.state_id, '{}'::bigint[]),
          COALESCE(r.loksabha_id, '{}'::bigint[]),
          COALESCE(r.assembly_id, '{}'::bigint[]),
          COALESCE(r.group_id, '{}'::bigint[]),
          public.dashboard_profile_ids_to_text_array(to_jsonb(r.profile_ids))
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.dashboard_event_visible_to_me(r public.events)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND r.status = 'published'
    AND r.deleted_at IS NULL
    AND (r.scheduled_at IS NULL OR r.scheduled_at <= now())
    AND r.start IS NOT NULL
    AND r.end IS NOT NULL
    AND public.dashboard_safe_timestamptz(r.start::text) IS NOT NULL
    AND public.dashboard_safe_timestamptz(r.end::text) IS NOT NULL
    AND now() >= public.dashboard_safe_timestamptz(r.start::text)
    AND now() <= public.dashboard_safe_timestamptz(r.end::text)
    AND EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE pr.id = auth.uid()
        AND pr.party_id IS NOT NULL
        AND pr.state_id IS NOT NULL
        AND public.dashboard_visibility_match(
          pr.id::text,
          pr.party_id::bigint,
          pr.state_id::bigint,
          pr.loksabha_id::bigint,
          pr.assembly_id::bigint,
          pr.group_id::bigint,
          COALESCE(r.party_id, '{}'::bigint[]),
          COALESCE(r.state_id, '{}'::bigint[]),
          COALESCE(r.loksabha_id, '{}'::bigint[]),
          COALESCE(r.assembly_id, '{}'::bigint[]),
          COALESCE(r.group_id, '{}'::bigint[]),
          public.dashboard_profile_ids_to_text_array(to_jsonb(r.profile_ids))
        )
    );
$$;

-- RLS helpers: SECURITY DEFINER + row_security off reads one row without policy recursion.
CREATE OR REPLACE FUNCTION public.dashboard_post_id_visible_for_rls(p_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(
    (
      SELECT public.dashboard_post_visible_to_me(po)
      FROM public.posts po
      WHERE po.id::text = p_id
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.dashboard_event_id_visible_for_rls(p_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(
    (
      SELECT public.dashboard_event_visible_to_me(ev)
      FROM public.events ev
      WHERE ev.id::text = p_id
      LIMIT 1
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Canonical dashboard RPCs (SECURITY DEFINER: explicit reader projection).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_posts()
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT po.*
  FROM public.posts po
  WHERE auth.uid() IS NOT NULL
    AND public.dashboard_post_visible_to_me(po)
  ORDER BY po.created_at DESC
  LIMIT 300;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_events()
RETURNS SETOF public.events
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ev.*
  FROM public.events ev
  WHERE auth.uid() IS NOT NULL
    AND public.dashboard_event_visible_to_me(ev)
  ORDER BY ev.end ASC
  LIMIT 500;
$$;

-- Backward-compatible names (same implementation).
CREATE OR REPLACE FUNCTION public.get_dashboard_posts_for_reader()
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.get_dashboard_posts();
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_events_for_reader()
RETURNS SETOF public.events
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.get_dashboard_events();
$$;

REVOKE ALL ON FUNCTION public.dashboard_visibility_match(text, bigint, bigint, bigint, bigint, bigint, bigint[], bigint[], bigint[], bigint[], bigint[], text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_safe_timestamptz(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_profile_ids_to_text_array(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_post_id_visible_for_rls(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_event_id_visible_for_rls(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dashboard_auth_is_elevated_editor() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.dashboard_post_id_visible_for_rls(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_event_id_visible_for_rls(text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_dashboard_posts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_events() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_posts_for_reader() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_events_for_reader() TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS: default deny; readers see visible rows; elevated roles see/modify all.
-- ---------------------------------------------------------------------------
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS posts_authenticated_select ON public.posts;
CREATE POLICY posts_authenticated_select
  ON public.posts
  FOR SELECT
  TO authenticated
  USING (
    public.dashboard_post_id_visible_for_rls(posts.id::text)
    OR public.dashboard_auth_is_elevated_editor()
  );

DROP POLICY IF EXISTS posts_authenticated_insert ON public.posts;
CREATE POLICY posts_authenticated_insert
  ON public.posts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.dashboard_auth_is_elevated_editor());

DROP POLICY IF EXISTS posts_authenticated_update ON public.posts;
CREATE POLICY posts_authenticated_update
  ON public.posts
  FOR UPDATE
  TO authenticated
  USING (public.dashboard_auth_is_elevated_editor())
  WITH CHECK (public.dashboard_auth_is_elevated_editor());

DROP POLICY IF EXISTS posts_authenticated_delete ON public.posts;
CREATE POLICY posts_authenticated_delete
  ON public.posts
  FOR DELETE
  TO authenticated
  USING (public.dashboard_auth_is_elevated_editor());

DROP POLICY IF EXISTS events_authenticated_select ON public.events;
CREATE POLICY events_authenticated_select
  ON public.events
  FOR SELECT
  TO authenticated
  USING (
    public.dashboard_event_id_visible_for_rls(events.id::text)
    OR public.dashboard_auth_is_elevated_editor()
  );

DROP POLICY IF EXISTS events_authenticated_insert ON public.events;
CREATE POLICY events_authenticated_insert
  ON public.events
  FOR INSERT
  TO authenticated
  WITH CHECK (public.dashboard_auth_is_elevated_editor());

DROP POLICY IF EXISTS events_authenticated_update ON public.events;
CREATE POLICY events_authenticated_update
  ON public.events
  FOR UPDATE
  TO authenticated
  USING (public.dashboard_auth_is_elevated_editor())
  WITH CHECK (public.dashboard_auth_is_elevated_editor());

DROP POLICY IF EXISTS events_authenticated_delete ON public.events;
CREATE POLICY events_authenticated_delete
  ON public.events
  FOR DELETE
  TO authenticated
  USING (public.dashboard_auth_is_elevated_editor());

-- ---------------------------------------------------------------------------
-- Reader-path indexes (partial, published + not deleted).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_posts_published_reader_created
  ON public.posts (created_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_published_reader_end
  ON public.events ("end" ASC)
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_published_scheduled_at
  ON public.posts (scheduled_at)
  WHERE status = 'published' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_published_scheduled_at
  ON public.events (scheduled_at)
  WHERE status = 'published' AND deleted_at IS NULL;
