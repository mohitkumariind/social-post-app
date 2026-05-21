-- RBAC schema repair: profile geo assignment columns + safer created_role orphan handling.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS assigned_loksabha_ids bigint[] NOT NULL DEFAULT '{}';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS assigned_assembly_ids bigint[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.profiles.assigned_loksabha_ids IS
  'Admin panel: Lok Sabha IDs the user may target (subset checks in permission-engine).';

COMMENT ON COLUMN public.profiles.assigned_assembly_ids IS
  'Admin panel: Assembly IDs the user may target (subset checks in permission-engine).';

-- Orphan events without creator profile: leave created_role NULL (fail-closed cross-role visibility).
UPDATE public.events
SET created_role = NULL
WHERE created_role = 'admin'
  AND created_by IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = events.created_by
  );

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
