-- Align get_dashboard_posts_v2 with server-side visibility (get_dashboard_posts_for_reader rules).
-- Safe on older DBs: add lifecycle columns if scheduling migrations were not applied yet.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS dashboard_category text,
  ADD COLUMN IF NOT EXISTS is_video boolean;

UPDATE public.posts
SET status = 'published'
WHERE status IS NULL;

UPDATE public.posts
SET is_video = false
WHERE is_video IS NULL;

ALTER TABLE public.posts
  ALTER COLUMN status SET DEFAULT 'published';

-- Self-contained: older DBs may not have applied 20260510190000 / 20260510210000 yet.
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

CREATE OR REPLACE FUNCTION public.get_dashboard_posts_v2(p_dashboard_category text DEFAULT NULL)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH prof AS (
    SELECT
      p.id::text AS profile_id,
      p.party_id::bigint AS party_id,
      p.state_id::bigint AS state_id,
      p.loksabha_id::bigint AS loksabha_id,
      p.assembly_id::bigint AS assembly_id,
      p.group_id::bigint AS group_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
  ),
  now_ts AS (SELECT now() AS ts)
  SELECT po.*
  FROM public.posts po
  CROSS JOIN prof pr
  CROSS JOIN now_ts n
  WHERE auth.uid() IS NOT NULL
    AND pr.party_id IS NOT NULL
    AND pr.state_id IS NOT NULL
    AND (po.is_video IS DISTINCT FROM true OR po.is_video IS NULL)
    AND COALESCE(po.status, 'published') = 'published'
    AND po.deleted_at IS NULL
    AND (po.scheduled_at IS NULL OR po.scheduled_at <= n.ts)
    AND (
      (p_dashboard_category IS NULL AND po.dashboard_category IS NULL)
      OR (p_dashboard_category IS NOT NULL AND po.dashboard_category = p_dashboard_category)
    )
    AND public.dashboard_visibility_match(
      pr.profile_id,
      pr.party_id,
      pr.state_id,
      pr.loksabha_id,
      pr.assembly_id,
      pr.group_id,
      COALESCE(po.party_id, '{}'::bigint[]),
      COALESCE(po.state_id, '{}'::bigint[]),
      COALESCE(po.loksabha_id, '{}'::bigint[]),
      COALESCE(po.assembly_id, '{}'::bigint[]),
      COALESCE(po.group_id, '{}'::bigint[]),
      COALESCE(
        ARRAY(
          SELECT trim(elem)
          FROM jsonb_array_elements_text(
            CASE jsonb_typeof(to_jsonb(po) -> 'profile_ids')
              WHEN 'array' THEN coalesce(to_jsonb(po) -> 'profile_ids', '[]'::jsonb)
              WHEN 'string' THEN coalesce(to_jsonb(po) -> 'profile_ids', '""'::jsonb)
              ELSE '[]'::jsonb
            END
          ) AS elem
        ),
        ARRAY[]::text[]
      )
    )
  ORDER BY po.created_at DESC
  LIMIT 300;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_posts_for_reader_v2(p_dashboard_category text DEFAULT NULL)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.get_dashboard_posts_v2(p_dashboard_category);
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_posts_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_posts_for_reader_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_posts_v2(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_posts_for_reader_v2(text) TO authenticated;

REVOKE ALL ON FUNCTION public.dashboard_visibility_match(
  text, bigint, bigint, bigint, bigint, bigint,
  bigint[], bigint[], bigint[], bigint[], bigint[], text[]
) FROM PUBLIC;
