-- Mobile dashboard visibility is aligned with centralized RBAC via:
-- - TypeScript: lib/rbac/content-visibility.ts (shared with utils/visibility.ts)
-- - SQL: dashboard_visibility_match (state AND party overlap; empty dimension = no extra restriction)
-- Admin cross-role published event visibility uses socialbot/lib/rbac/permission-engine.ts (canViewEvent).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'dashboard_visibility_match'
  ) THEN
    COMMENT ON FUNCTION public.dashboard_visibility_match IS
      'Reader profile vs content targeting. Empty arrays = no restriction on that dimension. State and party must both match when specified. Aligned with lib/rbac/content-visibility.ts.';
  END IF;
END $$;
