-- One-query post totals per event name (`posts.category` = `events.name`) for admin events list.
-- Invoked only from SocialBot server (service role). Not for anon/authenticated clients.

CREATE OR REPLACE FUNCTION public.admin_post_counts_by_event_categories(p_categories text[])
RETURNS TABLE (category text, post_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT p.category::text, COUNT(*)::bigint AS post_count
  FROM public.posts p
  WHERE p_categories IS NOT NULL
    AND cardinality(p_categories) > 0
    AND p.category = ANY (p_categories)
  GROUP BY p.category;
$$;

CREATE INDEX IF NOT EXISTS idx_posts_category
  ON public.posts (category);

REVOKE ALL ON FUNCTION public.admin_post_counts_by_event_categories(text[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_post_counts_by_event_categories(text[]) TO service_role;
