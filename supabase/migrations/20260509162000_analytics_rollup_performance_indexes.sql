-- Analytics rollup and time-window query performance hardening.
--
-- Why:
-- - Daily rollups query admin_logs by (resource_type, action_type, created_at range).
-- - Event activity analytics use overlap predicates: start <= X AND "end" >= Y.
-- - Dashboard reads recent posts and scheduled/published filters by time.
-- - Without targeted indexes, these patterns degrade to large scans as data grows.
--
-- Retention/archival guidance (operational):
-- - admin_logs / rbac_observability_events / notifications_history should be archived
--   by time partition or periodic cold-storage export once data volume grows.
-- - Keep hot-window indexes focused on recent, frequently queried rows.

-- 1) admin_logs lifecycle/action time-window acceleration
CREATE INDEX IF NOT EXISTS idx_admin_logs_resource_action_created_desc
  ON public.admin_logs (resource_type, action_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_logs_resource_created_desc
  ON public.admin_logs (resource_type, created_at DESC);

-- 2) events time-window and lifecycle acceleration
CREATE INDEX IF NOT EXISTS idx_events_status_scheduled_at
  ON public.events (status, scheduled_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_status_end
  ON public.events (status, "end")
  WHERE deleted_at IS NULL;

-- Overlap index for analytics query shape:
--   start <= dayEnd AND "end" >= dayStart
-- using tstzrange(start, "end", '[]') so the planner can use GiST for range overlap.
CREATE INDEX IF NOT EXISTS idx_events_active_window_gist
  ON public.events
  USING GIST (tstzrange(start, "end", '[]'))
  WHERE deleted_at IS NULL AND status IN ('published', 'scheduled_publish');

-- 3) posts dashboard/scheduled query acceleration
CREATE INDEX IF NOT EXISTS idx_posts_status_deleted_scheduled_created
  ON public.posts (status, deleted_at, scheduled_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_recent_published
  ON public.posts (created_at DESC)
  WHERE status = 'published' AND deleted_at IS NULL;

-- 4) notification rollup source table acceleration
CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_created_at
  ON public.notification_broadcasts (created_at DESC);

-- 5) observability/event stream time-window scans
CREATE INDEX IF NOT EXISTS idx_rbac_observability_created_at
  ON public.rbac_observability_events (created_at DESC);
