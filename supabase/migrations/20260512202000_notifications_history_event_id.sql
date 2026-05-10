-- Per-recipient notification history: optional link to public.events(id), aligned with notification_broadcasts.event_id.

ALTER TABLE public.notifications_history
  ADD COLUMN IF NOT EXISTS event_id uuid;

DO $$
BEGIN
  IF to_regclass('public.events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'notifications_history_event_id_fkey'
     ) THEN
    ALTER TABLE public.notifications_history
      ADD CONSTRAINT notifications_history_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES public.events (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_history_event_id
  ON public.notifications_history (event_id)
  WHERE event_id IS NOT NULL;

-- Backfill from parent broadcast when history rows predate this column.
UPDATE public.notifications_history nh
SET event_id = nb.event_id
FROM public.notification_broadcasts nb
WHERE nh.broadcast_id = nb.id
  AND nb.event_id IS NOT NULL
  AND nh.event_id IS NULL;
