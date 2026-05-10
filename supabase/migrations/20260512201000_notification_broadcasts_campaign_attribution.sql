-- Campaign attribution on notification_broadcasts (schema-only; broadcast pipeline unchanged).
--
-- event_id: uuid (nullable), matches public.events(id) for joins and FK integrity. Client/API use UUID strings.
--   (A separate TEXT event_id column would duplicate semantics and break the existing FK to events.)
-- campaign_id: opaque text for future campaign-level attribution; NULL until callers write it.

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

ALTER TABLE public.notification_broadcasts
  ADD COLUMN IF NOT EXISTS campaign_id text;

COMMENT ON COLUMN public.notification_broadcasts.campaign_id IS
  'Optional future campaign identifier (text). Reserved; not yet populated by the broadcast system.';

CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_event_id
  ON public.notification_broadcasts (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_campaign_id
  ON public.notification_broadcasts (campaign_id)
  WHERE campaign_id IS NOT NULL;
