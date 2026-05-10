-- Optional denormalized fields on notification_open for reliable client-attributed opens.

ALTER TABLE public.notification_open
  ADD COLUMN IF NOT EXISTS notifications_history_id uuid REFERENCES public.notifications_history (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id uuid;

CREATE INDEX IF NOT EXISTS idx_notification_open_notifications_history_id
  ON public.notification_open (notifications_history_id)
  WHERE notifications_history_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_open_event_id
  ON public.notification_open (event_id)
  WHERE event_id IS NOT NULL;
