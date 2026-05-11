-- Dashboard Quick Categories: optional classification for posts.
-- This does NOT change the existing Event → Post relationship:
-- `posts.category` remains the event name (legacy design).
-- `posts.dashboard_category` controls dashboard chip filtering only.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS dashboard_category text NULL;

-- Constrain allowed values (null means "none")
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'posts_dashboard_category_allowed'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_dashboard_category_allowed
      CHECK (
        dashboard_category IS NULL
        OR dashboard_category IN (
          'good_morning',
          'good_night',
          'motivation',
          'devotional',
          'birthday_wishes'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_dashboard_category_created_at
  ON public.posts (dashboard_category, created_at DESC);

-- ---------------------------------------------------------------------------
-- RPC v2: fetch dashboard posts with optional quick-category filter.
-- - When p_dashboard_category IS NULL: returns ONLY uncategorized posts (default dashboard feed).
-- - When p_dashboard_category IS NOT NULL: returns ONLY matching category posts (chip-selected view).
-- RLS still applies (SECURITY INVOKER).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_posts_v2(p_dashboard_category text DEFAULT NULL)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT po.*
  FROM public.posts po
  WHERE auth.uid() IS NOT NULL
    AND (
      (p_dashboard_category IS NULL AND po.dashboard_category IS NULL)
      OR (p_dashboard_category IS NOT NULL AND po.dashboard_category = p_dashboard_category)
    )
  ORDER BY po.created_at DESC
  LIMIT 300;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_posts_for_reader_v2(p_dashboard_category text DEFAULT NULL)
RETURNS SETOF public.posts
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM public.get_dashboard_posts_v2(p_dashboard_category);
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_posts_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_posts_for_reader_v2(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_posts_v2(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_posts_for_reader_v2(text) TO authenticated;

