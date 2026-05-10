-- Repair: events.created_by must exist before idx_events_created_by (if 20260512100000 failed mid-file).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_events_created_by
  ON public.events (created_by)
  WHERE created_by IS NOT NULL;
