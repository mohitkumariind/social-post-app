-- Leaderboard: single backend entrypoint. Scope + limit only from client; party/state ALWAYS from auth.uid() profile.
-- Rejects invalid scope. Existing get_leaderboard_* functions delegate here (same security model).

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

  IF sc = 'state' THEN
    lim := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
  ELSE
    lim := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  END IF;

  RETURN QUERY
  WITH viewer AS (
    SELECT p.party_id AS vid_party, p.state_id AS vid_state
    FROM public.profiles p
    WHERE p.id = auth.uid()
  ),
  agg AS (
    SELECT d.user_id AS uid, COUNT(*)::bigint AS pts
    FROM public.post_downloads d
    GROUP BY d.user_id
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY a.pts DESC NULLS LAST, pr.name ASC)::bigint AS leader_rank,
    pr.id AS profile_id,
    COALESCE(NULLIF(btrim(pr.name::text), ''), 'User')::text AS display_name,
    COALESCE(pr.avatar_url::text, '')::text AS avatar_url,
    COALESCE(pr.instagram::text, '')::text AS instagram,
    a.pts AS points
  FROM public.profiles pr
  INNER JOIN agg a ON a.uid = pr.id
  CROSS JOIN viewer v
  WHERE
    (sc = 'national' AND v.vid_party IS NOT NULL AND pr.party_id = v.vid_party)
    OR (
      sc = 'state'
      AND v.vid_party IS NOT NULL
      AND v.vid_state IS NOT NULL
      AND pr.party_id = v.vid_party
      AND pr.state_id = v.vid_state
    )
  ORDER BY a.pts DESC, pr.name ASC
  LIMIT lim;
END;
$$;

-- Thin wrappers: preserve signatures & grants; implementation is centralized above.
CREATE OR REPLACE FUNCTION public.get_leaderboard_state_party(p_limit int DEFAULT 50)
RETURNS TABLE (
  leader_rank bigint,
  profile_id uuid,
  display_name text,
  avatar_url text,
  instagram text,
  points bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT * FROM public.get_leaderboard('state', COALESCE(p_limit, 50));
$$;

CREATE OR REPLACE FUNCTION public.get_leaderboard_national_party(p_limit int DEFAULT 10)
RETURNS TABLE (
  leader_rank bigint,
  profile_id uuid,
  display_name text,
  avatar_url text,
  instagram text,
  points bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT * FROM public.get_leaderboard('national', COALESCE(p_limit, 10));
$$;

REVOKE ALL ON FUNCTION public.get_leaderboard(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(text, integer) TO authenticated;
