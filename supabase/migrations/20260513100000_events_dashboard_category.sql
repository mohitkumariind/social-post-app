-- Event-level dashboard quick category (global dashboard content events).
-- NULL = none (uncategorized for dashboard chips).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS dashboard_category text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_dashboard_category_allowed'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_dashboard_category_allowed
      CHECK (
        dashboard_category IS NULL
        OR dashboard_category IN (
          'good_morning',
          'good_night',
          'motivation',
          'devotional',
          'birthday_wishes'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_dashboard_category_created_at
  ON public.events (dashboard_category, created_at DESC);

-- Backfill post rows from their event when the event has a category (repair / migration).
UPDATE public.posts po
SET dashboard_category = e.dashboard_category
FROM public.events e
WHERE po.category = e.name
  AND e.dashboard_category IS NOT NULL
  AND (po.dashboard_category IS DISTINCT FROM e.dashboard_category);
