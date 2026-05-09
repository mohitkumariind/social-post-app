-- Worker reliability hardening:
-- 1) add lease/retry columns to events scheduler rows
-- 2) persist scheduled_notifications -> notification_broadcasts linkage for retry idempotency
-- 3) enforce per-broadcast notification history uniqueness

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT;

CREATE INDEX IF NOT EXISTS idx_events_sched_due_partial
  ON public.events (scheduled_at, id)
  WHERE status = 'scheduled_publish' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_sched_processing_lease
  ON public.events (locked_at, scheduled_at)
  WHERE status = 'processing_publish' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_sched_status_scheduled
  ON public.events (status, scheduled_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public.scheduled_notifications
  ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES public.notification_broadcasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_broadcast_id
  ON public.scheduled_notifications (broadcast_id)
  WHERE broadcast_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_history_broadcast_user_unique
  ON public.notifications_history (broadcast_id, user_id)
  WHERE broadcast_id IS NOT NULL;
