-- Events workflow + soft delete (core entity)

-- 1) Ownership support if not already present
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2) Workflow status
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3) Soft delete
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 4) Backfill existing rows so current mobile behavior doesn't break
UPDATE public.events
SET status = 'published'
WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_status
  ON public.events (status);
CREATE INDEX IF NOT EXISTS idx_events_deleted_at
  ON public.events (deleted_at);
CREATE INDEX IF NOT EXISTS idx_events_created_by
  ON public.events (created_by);

