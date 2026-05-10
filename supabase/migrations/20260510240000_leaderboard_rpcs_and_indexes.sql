-- Leaderboard: party + state scoped RPCs (SECURITY DEFINER). Points = COUNT(post_downloads) per user.
-- State board: same party_id + state_id as viewer. National: same party_id (all states).

CREATE INDEX IF NOT EXISTS idx_post_downloads_user_id_agg
  ON public.post_downloads (user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_leaderboard_party_state
  ON public.profiles (party_id, state_id)
  WHERE party_id IS NOT NULL AND state_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_leaderboard_party
  ON public.profiles (party_id)
  WHERE party_id IS NOT NULL;

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
  WHERE v.vid_party IS NOT NULL
    AND v.vid_state IS NOT NULL
    AND pr.party_id = v.vid_party
    AND pr.state_id = v.vid_state
  ORDER BY a.pts DESC, pr.name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
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
  WITH viewer AS (
    SELECT p.party_id AS vid_party
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
  WHERE v.vid_party IS NOT NULL
    AND pr.party_id = v.vid_party
  ORDER BY a.pts DESC, pr.name ASC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.get_leaderboard_state_party(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_leaderboard_national_party(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_state_party(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_national_party(integer) TO authenticated;
