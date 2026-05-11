-- Compatibility patch: ensure dashboard reader RPCs exist.
-- Some DBs may not have applied the core dashboard migration yet, but the mobile app
-- falls back to these names when the primary RPC is missing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_dashboard_posts_for_reader'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    CREATE OR REPLACE FUNCTION public.get_dashboard_posts_for_reader()
    RETURNS SETOF public.posts
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
      SELECT * FROM public.get_dashboard_posts();
    $fn$;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_dashboard_events_for_reader'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    CREATE OR REPLACE FUNCTION public.get_dashboard_events_for_reader()
    RETURNS SETOF public.events
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
      SELECT * FROM public.get_dashboard_events();
    $fn$;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.get_dashboard_posts_for_reader() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_events_for_reader() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_dashboard_posts_for_reader() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_events_for_reader() TO authenticated;

