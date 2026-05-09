-- Worker lock/retry queue hardening:
-- - strict lock ownership token
-- - retry scheduling metadata (next_retry_at / last_attempt_at)
-- - deterministic scheduled notification -> broadcast identity
-- - per-recipient delivery status to support idempotent retry resume

ALTER TABLE public.scheduled_notifications
  ADD COLUMN IF NOT EXISTS lock_token TEXT,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS lock_token TEXT,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS lock_token TEXT,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

-- Backfill retry schedule to current scheduled time for existing rows.
UPDATE public.scheduled_notifications
SET next_retry_at = scheduled_at
WHERE next_retry_at IS NULL;

UPDATE public.posts
SET next_retry_at = scheduled_at
WHERE next_retry_at IS NULL AND scheduled_at IS NOT NULL;

UPDATE public.events
SET next_retry_at = scheduled_at
WHERE next_retry_at IS NULL AND scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_retry_due
  ON public.scheduled_notifications (status, next_retry_at, scheduled_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_processing_lease_token
  ON public.scheduled_notifications (locked_at, lock_token, id)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_posts_retry_due
  ON public.posts (status, next_retry_at, scheduled_at)
  WHERE status = 'scheduled_publish' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_processing_lease_token
  ON public.posts (locked_at, lock_token, id)
  WHERE status = 'processing_publish' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_retry_due
  ON public.events (status, next_retry_at, scheduled_at)
  WHERE status = 'scheduled_publish' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_processing_lease_token
  ON public.events (locked_at, lock_token, id)
  WHERE status = 'processing_publish' AND deleted_at IS NULL;

ALTER TABLE public.notification_broadcasts
  ADD COLUMN IF NOT EXISTS scheduled_notification_id UUID
  REFERENCES public.scheduled_notifications(id)
  ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_broadcasts_scheduled_notification_unique
  ON public.notification_broadcasts (scheduled_notification_id)
  WHERE scheduled_notification_id IS NOT NULL;

ALTER TABLE public.notifications_history
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS delivery_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notifications_history_delivery_status_whitelist'
  ) THEN
    ALTER TABLE public.notifications_history
      ADD CONSTRAINT notifications_history_delivery_status_whitelist
      CHECK (delivery_status IN ('pending', 'sent', 'failed_retryable', 'failed_permanent')) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_history_broadcast_delivery
  ON public.notifications_history (broadcast_id, delivery_status, user_id)
  WHERE broadcast_id IS NOT NULL;
