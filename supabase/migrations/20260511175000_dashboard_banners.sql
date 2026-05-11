-- Dashboard banners: admin-controlled carousel on mobile dashboard.
-- Notes:
-- - Intended consumer is the mobile app via RPC `public.get_dashboard_banners()`.
-- - Admin tooling uses service-role APIs; RLS still allows elevated editors.

-- ---------------------------------------------------------------------------
-- Enum for click actions
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dashboard_banner_link_type') THEN
    CREATE TYPE public.dashboard_banner_link_type AS ENUM ('none', 'event', 'post', 'external_url');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Compatibility: some DBs may not have the helper from earlier migrations yet.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'dashboard_auth_is_elevated_editor'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    CREATE OR REPLACE FUNCTION public.dashboard_auth_is_elevated_editor()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY INVOKER
    SET search_path = public
    AS $fn$
      SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND COALESCE(p.role, 'user') IN ('admin', 'moderator', 'campaign_manager', 'super_admin')
      );
    $fn$;

    REVOKE ALL ON FUNCTION public.dashboard_auth_is_elevated_editor() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.dashboard_auth_is_elevated_editor() TO authenticated;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dashboard_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_url text NOT NULL,
  title text NULL,
  subtitle text NULL,
  cta_text text NULL,
  link_type public.dashboard_banner_link_type NOT NULL DEFAULT 'none',
  link_value text NULL,
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  start_at timestamptz NULL,
  end_at timestamptz NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_banners_valid_schedule CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at),
  CONSTRAINT dashboard_banners_link_value_required CHECK (
    (link_type IN ('none') AND (link_value IS NULL OR btrim(link_value) = ''))
    OR (link_type IN ('event', 'post', 'external_url') AND link_value IS NOT NULL AND btrim(link_value) <> '')
  )
);

-- Helpful indexes: active window + ordering.
CREATE INDEX IF NOT EXISTS idx_dashboard_banners_active_window
  ON public.dashboard_banners (is_active, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_dashboard_banners_priority
  ON public.dashboard_banners (priority, created_at);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dashboard_banners_updated_at ON public.dashboard_banners;
CREATE TRIGGER trg_dashboard_banners_updated_at
BEFORE UPDATE ON public.dashboard_banners
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------------
-- RLS: default deny; dashboard can read only active+scheduled; elevated editors read/write all.
-- ---------------------------------------------------------------------------
ALTER TABLE public.dashboard_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_banners_authenticated_select ON public.dashboard_banners;
CREATE POLICY dashboard_banners_authenticated_select
  ON public.dashboard_banners
  FOR SELECT
  TO authenticated
  USING (
    (
      is_active = true
      AND (start_at IS NULL OR start_at <= now())
      AND (end_at IS NULL OR end_at >= now())
    )
    OR public.dashboard_auth_is_elevated_editor()
  );

DROP POLICY IF EXISTS dashboard_banners_authenticated_insert ON public.dashboard_banners;
CREATE POLICY dashboard_banners_authenticated_insert
  ON public.dashboard_banners
  FOR INSERT
  TO authenticated
  WITH CHECK (public.dashboard_auth_is_elevated_editor());

DROP POLICY IF EXISTS dashboard_banners_authenticated_update ON public.dashboard_banners;
CREATE POLICY dashboard_banners_authenticated_update
  ON public.dashboard_banners
  FOR UPDATE
  TO authenticated
  USING (public.dashboard_auth_is_elevated_editor())
  WITH CHECK (public.dashboard_auth_is_elevated_editor());

DROP POLICY IF EXISTS dashboard_banners_authenticated_delete ON public.dashboard_banners;
CREATE POLICY dashboard_banners_authenticated_delete
  ON public.dashboard_banners
  FOR DELETE
  TO authenticated
  USING (public.dashboard_auth_is_elevated_editor());

-- ---------------------------------------------------------------------------
-- RPC: dashboard fetch (minimal payload, sorted)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_dashboard_banners(p_limit int DEFAULT 10)
RETURNS TABLE (
  id uuid,
  image_url text,
  title text,
  subtitle text,
  cta_text text,
  link_type public.dashboard_banner_link_type,
  link_value text,
  priority int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    b.image_url,
    b.title,
    b.subtitle,
    b.cta_text,
    b.link_type,
    b.link_value,
    b.priority
  FROM public.dashboard_banners b
  WHERE
    b.is_active = true
    AND (b.start_at IS NULL OR b.start_at <= now())
    AND (b.end_at IS NULL OR b.end_at >= now())
  ORDER BY b.priority ASC, b.created_at DESC
  LIMIT GREATEST(0, LEAST(COALESCE(p_limit, 10), 25));
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_banners(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_dashboard_banners(int) TO authenticated;

