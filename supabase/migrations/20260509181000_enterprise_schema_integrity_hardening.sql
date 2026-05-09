-- Enterprise schema integrity hardening (additive, fail-closed for new writes).
-- This migration intentionally avoids destructive changes and preserves current APIs/workflows.
-- Where legacy data may exist, constraints are added as NOT VALID so existing rows are preserved
-- while all new writes must satisfy integrity rules.

-- ---------------------------------------------------------------------------
-- Reusable validators for RBAC scope arrays.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_positive_bigint_array(a bigint[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    a IS NULL
    OR cardinality(a) = 0
    OR COALESCE((SELECT bool_and(v > 0) FROM unnest(a) AS v), true);
$$;

CREATE OR REPLACE FUNCTION public.is_canonical_numeric_text_array(a text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    a IS NULL
    OR cardinality(a) = 0
    OR COALESCE(
      (
        SELECT bool_and(v ~ '^[1-9][0-9]*$')
        FROM unnest(a) AS v
      ),
      true
    );
$$;

-- ---------------------------------------------------------------------------
-- Lifecycle/status hardening (enum-like text fields).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_status_whitelist'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_status_whitelist
      CHECK (status IN ('published', 'scheduled_publish', 'processing_publish', 'archived', 'scheduled_publish_failed'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_status_whitelist'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_status_whitelist
      CHECK (status IN ('published', 'scheduled_publish', 'processing_publish', 'scheduled_publish_failed'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_notifications' AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_notifications_status_whitelist'
  ) THEN
    ALTER TABLE public.scheduled_notifications
      ADD CONSTRAINT scheduled_notifications_status_whitelist
      CHECK (status IN ('pending', 'processing', 'failed', 'sent', 'cancelled'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_logs' AND column_name = 'severity'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_logs_severity_whitelist'
  ) THEN
    ALTER TABLE public.admin_logs
      ADD CONSTRAINT admin_logs_severity_whitelist
      CHECK (severity IN ('info', 'warning', 'critical'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_whitelist'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_whitelist
      CHECK (role IN ('user', 'admin', 'moderator', 'campaign_manager'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_notifications' AND column_name = 'created_role'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_notifications_created_role_whitelist'
  ) THEN
    ALTER TABLE public.scheduled_notifications
      ADD CONSTRAINT scheduled_notifications_created_role_whitelist
      CHECK (created_role IN ('admin', 'moderator', 'campaign_manager', 'system'))
      NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RBAC assignment integrity (scope + role coupling).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'assigned_state_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_assigned_state_ids_positive'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_assigned_state_ids_positive
      CHECK (public.is_positive_bigint_array(assigned_state_ids))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'assigned_group_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_assigned_group_ids_canonical'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_assigned_group_ids_canonical
      CHECK (public.is_canonical_numeric_text_array(assigned_group_ids))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'assigned_state_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_moderator_requires_assigned_states'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_moderator_requires_assigned_states
      CHECK (role <> 'moderator' OR cardinality(COALESCE(assigned_state_ids, '{}'::bigint[])) > 0)
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'assigned_group_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_cm_requires_assigned_groups'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_cm_requires_assigned_groups
      CHECK (role <> 'campaign_manager' OR cardinality(COALESCE(assigned_group_ids, '{}'::text[])) > 0)
      NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Scope column integrity hardening.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_logs' AND column_name = 'scope_state_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_logs_scope_state_ids_positive'
  ) THEN
    ALTER TABLE public.admin_logs
      ADD CONSTRAINT admin_logs_scope_state_ids_positive
      CHECK (public.is_positive_bigint_array(scope_state_ids))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_logs' AND column_name = 'scope_group_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_logs_scope_group_ids_canonical'
  ) THEN
    ALTER TABLE public.admin_logs
      ADD CONSTRAINT admin_logs_scope_group_ids_canonical
      CHECK (public.is_canonical_numeric_text_array(scope_group_ids))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rbac_observability_events' AND column_name = 'scope_state_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rbac_obs_scope_state_ids_positive'
  ) THEN
    ALTER TABLE public.rbac_observability_events
      ADD CONSTRAINT rbac_obs_scope_state_ids_positive
      CHECK (public.is_positive_bigint_array(scope_state_ids))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rbac_observability_events' AND column_name = 'scope_group_ids'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rbac_obs_scope_group_ids_canonical'
  ) THEN
    ALTER TABLE public.rbac_observability_events
      ADD CONSTRAINT rbac_obs_scope_group_ids_canonical
      CHECK (public.is_canonical_numeric_text_array(scope_group_ids))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'target_groups'
      AND data_type = 'ARRAY'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_target_groups_canonical'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_target_groups_canonical
      CHECK (
        CASE
          WHEN target_groups IS NULL THEN true
          ELSE public.is_canonical_numeric_text_array(target_groups::text[])
        END
      )
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'state_id'
      AND data_type = 'ARRAY'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_state_id_positive'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_state_id_positive
      CHECK (
        CASE
          WHEN state_id IS NULL THEN true
          ELSE public.is_positive_bigint_array(state_id::bigint[])
        END
      )
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'posts'
      AND column_name = 'state_id'
      AND data_type = 'ARRAY'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_state_id_positive'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_state_id_positive
      CHECK (
        CASE
          WHEN state_id IS NULL THEN true
          ELSE public.is_positive_bigint_array(state_id::bigint[])
        END
      )
      NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Retry/lease and nullable lifecycle safety checks.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'scheduled_notifications' AND column_name = 'attempt_count'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_notifications_attempt_nonnegative'
  ) THEN
    ALTER TABLE public.scheduled_notifications
      ADD CONSTRAINT scheduled_notifications_attempt_nonnegative
      CHECK (attempt_count >= 0)
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'attempt_count'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_attempt_nonnegative'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_attempt_nonnegative
      CHECK (attempt_count >= 0)
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'attempt_count'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_attempt_nonnegative'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_attempt_nonnegative
      CHECK (attempt_count >= 0)
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'deleted_at'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'deleted_by'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_deleted_by_requires_deleted_at'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_deleted_by_requires_deleted_at
      CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'deleted_at'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = 'deleted_by'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'groups_deleted_by_requires_deleted_at'
  ) THEN
    ALTER TABLE public.groups
      ADD CONSTRAINT groups_deleted_by_requires_deleted_at
      CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.notification_templates
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_templates' AND column_name = 'deleted_at'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_templates' AND column_name = 'deleted_by'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notification_templates_deleted_by_requires_deleted_at'
  ) THEN
    ALTER TABLE public.notification_templates
      ADD CONSTRAINT notification_templates_deleted_by_requires_deleted_at
      CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Foreign-key hardening for likely orphan paths.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'group_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'groups'
  ) AND EXISTS (
    SELECT 1
    FROM pg_attribute p
    JOIN pg_class pc ON pc.oid = p.attrelid
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    JOIN pg_attribute g ON g.attname = 'id'
    JOIN pg_class gc ON gc.oid = g.attrelid
    JOIN pg_namespace gn ON gn.oid = gc.relnamespace
    WHERE pn.nspname = 'public'
      AND pc.relname = 'posts'
      AND p.attname = 'group_id'
      AND gn.nspname = 'public'
      AND gc.relname = 'groups'
      AND p.atttypid = g.atttypid
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_group_id_fkey'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_group_id_fkey
      FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications_history' AND column_name = 'user_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_history_user_id_profiles_fkey'
  ) THEN
    ALTER TABLE public.notifications_history
      ADD CONSTRAINT notifications_history_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Partial/composite index hardening for active + scheduler paths.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sched_notif_due_pending_failed
  ON public.scheduled_notifications (scheduled_at, id)
  WHERE status IN ('pending', 'failed') AND attempt_count < 5;

CREATE INDEX IF NOT EXISTS idx_sched_notif_stale_processing
  ON public.scheduled_notifications (locked_at, id)
  WHERE status = 'processing' AND attempt_count < 5;

CREATE INDEX IF NOT EXISTS idx_notification_templates_active_created
  ON public.notification_templates (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_groups_active_by_id
  ON public.groups (id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_sched_processing_lease_active
  ON public.posts (locked_at)
  WHERE status = 'processing_publish' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_logs_scope_states_gin
  ON public.admin_logs USING GIN (scope_state_ids);

CREATE INDEX IF NOT EXISTS idx_admin_logs_scope_groups_gin
  ON public.admin_logs USING GIN (scope_group_ids);

-- ---------------------------------------------------------------------------
-- Operational note:
-- To fully enforce historical data correctness, run:
--   ALTER TABLE ... VALIDATE CONSTRAINT ...
-- after cleaning legacy rows reported by supabase/scripts/integrity-verification.sql
-- ---------------------------------------------------------------------------
