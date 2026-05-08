-- Events scheduled publishing support (minimal schema change)
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

