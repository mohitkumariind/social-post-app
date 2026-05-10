-- Legacy notification data: rows with NULL event_id remain non–event-linked (global bucket).
-- Do not backfill or infer event_id from titles, filters, or posts — keeps analytics honest.

COMMENT ON COLUMN public.notification_broadcasts.event_id IS
  'NULL for legacy broadcasts (not event-linked). Set only when a send explicitly attributes an event; never backfilled from heuristics.';

COMMENT ON COLUMN public.notifications_history.event_id IS
  'NULL when the parent broadcast had no event_id. Matches broadcast row; not retro-mapped to events.';
