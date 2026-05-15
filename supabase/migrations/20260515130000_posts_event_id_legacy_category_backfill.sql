-- One-time historical fix: set posts.event_id from posts.category = events.name
-- for legacy rows where event_id was never written. Analytics RPCs unchanged.
--
-- Match rule (aligned with socialbot resolvePostEventId): btrim(category) = btrim(events.name)
-- Safety: only event_id IS NULL; skip empty categories; skip ambiguous event names (count > 1).
--
-- ---------------------------------------------------------------------------
-- Verification (run in SQL editor before / after applying)
-- ---------------------------------------------------------------------------
-- -- Before: legacy posts missing event_id but with a category label
-- SELECT COUNT(*) AS orphan_posts_with_category
-- FROM public.posts p
-- WHERE p.event_id IS NULL
--   AND btrim(COALESCE(p.category::text, '')) <> '';
--
-- -- Before: how many orphans have a unique event name match (will be updated)
-- WITH unique_event_names AS (
--   SELECT btrim(ev.name::text) AS norm_name
--   FROM public.events ev
--   WHERE btrim(COALESCE(ev.name::text, '')) <> ''
--   GROUP BY btrim(ev.name::text)
--   HAVING COUNT(*) = 1
-- )
-- SELECT COUNT(*) AS backfill_eligible
-- FROM public.posts p
-- INNER JOIN unique_event_names u
--   ON btrim(COALESCE(p.category::text, '')) = u.norm_name
-- WHERE p.event_id IS NULL;
--
-- -- Before: ambiguous event names (skipped intentionally)
-- SELECT btrim(ev.name::text) AS norm_name, COUNT(*) AS event_rows
-- FROM public.events ev
-- WHERE btrim(COALESCE(ev.name::text, '')) <> ''
-- GROUP BY btrim(ev.name::text)
-- HAVING COUNT(*) > 1;
--
-- -- After: rows updated by this migration
-- SELECT COUNT(*) AS backfilled_rows
-- FROM public._posts_event_id_category_backfill_audit;
--
-- -- After: remaining orphans with category but no unique name match
-- SELECT COUNT(*) AS orphan_posts_still_unlinked
-- FROM public.posts p
-- WHERE p.event_id IS NULL
--   AND btrim(COALESCE(p.category::text, '')) <> '';
--
-- -- Rollback (manual, only rows touched by this migration):
-- -- UPDATE public.posts p
-- -- SET event_id = NULL
-- -- FROM public._posts_event_id_category_backfill_audit a
-- -- WHERE p.id = a.post_id
-- --   AND p.event_id = a.event_id;
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public._posts_event_id_category_backfill_audit (
  post_id uuid PRIMARY KEY,
  event_id uuid NOT NULL,
  category_norm text NOT NULL,
  backfilled_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public._posts_event_id_category_backfill_audit IS
  'Internal migration audit (20260515130000). Not exposed to mobile clients; SQL editor / service role only.';

-- Default-deny: no RLS policies for anon/authenticated (same pattern as admin_logs).
ALTER TABLE public._posts_event_id_category_backfill_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public._posts_event_id_category_backfill_audit FROM PUBLIC;
REVOKE ALL ON TABLE public._posts_event_id_category_backfill_audit FROM anon;
REVOKE ALL ON TABLE public._posts_event_id_category_backfill_audit FROM authenticated;
GRANT ALL ON TABLE public._posts_event_id_category_backfill_audit TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'posts'
      AND column_name = 'event_id'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'posts'
      AND column_name = 'category'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'name'
  ) THEN
    RAISE NOTICE 'posts_event_id_legacy_category_backfill: skipped (posts.event_id, posts.category, or events.name missing)';
    RETURN;
  END IF;

  WITH unique_event_names AS (
    SELECT
      btrim(ev.name::text) AS norm_name,
      (array_agg(ev.id))[1] AS event_id
    FROM public.events ev
    WHERE btrim(COALESCE(ev.name::text, '')) <> ''
    GROUP BY btrim(ev.name::text)
    HAVING COUNT(*) = 1
  ),
  candidates AS (
    SELECT
      p.id AS post_id,
      u.event_id,
      btrim(p.category::text) AS category_norm
    FROM public.posts p
    INNER JOIN unique_event_names u
      ON btrim(COALESCE(p.category::text, '')) = u.norm_name
    WHERE p.event_id IS NULL
      AND btrim(COALESCE(p.category::text, '')) <> ''
  )
  UPDATE public.posts p
  SET event_id = c.event_id
  FROM candidates c
  WHERE p.id = c.post_id
    AND p.event_id IS NULL;

  WITH unique_event_names AS (
    SELECT
      btrim(ev.name::text) AS norm_name,
      (array_agg(ev.id))[1] AS event_id
    FROM public.events ev
    WHERE btrim(COALESCE(ev.name::text, '')) <> ''
    GROUP BY btrim(ev.name::text)
    HAVING COUNT(*) = 1
  ),
  candidates AS (
    SELECT
      p.id AS post_id,
      u.event_id,
      btrim(p.category::text) AS category_norm
    FROM public.posts p
    INNER JOIN unique_event_names u
      ON btrim(COALESCE(p.category::text, '')) = u.norm_name
    WHERE btrim(COALESCE(p.category::text, '')) <> ''
  )
  INSERT INTO public._posts_event_id_category_backfill_audit (post_id, event_id, category_norm)
  SELECT c.post_id, c.event_id, c.category_norm
  FROM candidates c
  INNER JOIN public.posts p ON p.id = c.post_id AND p.event_id = c.event_id
  ON CONFLICT (post_id) DO NOTHING;

  RAISE NOTICE 'posts_event_id_legacy_category_backfill: audited % row(s)',
    (SELECT COUNT(*) FROM public._posts_event_id_category_backfill_audit);
END $$;
