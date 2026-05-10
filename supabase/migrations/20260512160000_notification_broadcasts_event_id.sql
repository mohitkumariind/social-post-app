-- Campaign Intelligence v2: optional link from a broadcast to an event (nullable, backward compatible).

ALTER TABLE public.notification_broadcasts
  ADD COLUMN IF NOT EXISTS event_id uuid;

DO $$
BEGIN
  IF to_regclass('public.events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = 'notification_broadcasts_event_id_fkey'
     ) THEN
    ALTER TABLE public.notification_broadcasts
      ADD CONSTRAINT notification_broadcasts_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES public.events (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_event_id
  ON public.notification_broadcasts (event_id)
  WHERE event_id IS NOT NULL;
