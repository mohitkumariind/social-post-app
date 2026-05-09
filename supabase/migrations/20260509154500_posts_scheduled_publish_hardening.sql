-- Scheduled posts worker hardening: lease/idempotency/retry columns + scheduler indexes.
-- This migration is backward-compatible: columns are added only if missing.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attempt_count INT,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT;

UPDATE public.posts
SET status = 'published'
WHERE status IS NULL;

ALTER TABLE public.posts
  ALTER COLUMN status SET DEFAULT 'published';

UPDATE public.posts
SET attempt_count = 0
WHERE attempt_count IS NULL;

ALTER TABLE public.posts
  ALTER COLUMN attempt_count SET DEFAULT 0,
  ALTER COLUMN attempt_count SET NOT NULL;

-- Indexes for due-row lookup and stale-lease recovery.
CREATE INDEX IF NOT EXISTS idx_posts_sched_due_partial
  ON public.posts (scheduled_at)
  WHERE status = 'scheduled_publish' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_sched_processing_lease
  ON public.posts (locked_at)
  WHERE status = 'processing_publish';

CREATE INDEX IF NOT EXISTS idx_posts_sched_status_scheduled_deleted
  ON public.posts (status, scheduled_at, deleted_at);
