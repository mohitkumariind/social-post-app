-- Campaign analytics: core schema alignment (FKs + indexes only; no analytics RPCs here).
-- Assumes public.posts, public.events, public.profiles, public.post_downloads already exist (Supabase / prior migrations).

-- ---------------------------------------------------------------------------
-- events: title + scope helpers (additive; keeps existing "name" for app compatibility)
-- ---------------------------------------------------------------------------
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS title text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'name'
  ) THEN
    EXECUTE $u$
      UPDATE public.events e
      SET title = COALESCE(NULLIF(btrim(e.title), ''), NULLIF(btrim(e.name::text), ''))
      WHERE e.title IS NULL OR btrim(e.title) = ''
    $u$;
  END IF;
END $$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS scope_type text,
  ADD COLUMN IF NOT EXISTS scope_value text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_scope_type_allowed'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_scope_type_allowed
      CHECK (scope_type IS NULL OR lower(scope_type) IN ('state', 'group', 'party', 'global'))
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_created_by
  ON public.events (created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_scope_type
  ON public.events (lower(scope_type))
  WHERE scope_type IS NOT NULL;

-- ---------------------------------------------------------------------------
-- posts: event_id (same type as events.id) + ownership; FK to events(id)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  ev_id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO ev_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'events'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF ev_id_type IS NULL THEN
    RAISE NOTICE 'campaign_analytics_core_schema: public.events.id not found; skipping posts.event_id';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'event_id'
  ) THEN
    EXECUTE format('ALTER TABLE public.posts ADD COLUMN event_id %s', ev_id_type);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'posts_event_id_fkey'
  ) THEN
    ALTER TABLE public.posts
      ADD CONSTRAINT posts_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES public.events (id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_posts_event_id
  ON public.posts (event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_event_created
  ON public.posts (event_id, created_at DESC)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_created_by
  ON public.posts (created_by)
  WHERE created_by IS NOT NULL;

-- Mandatory event_id only when no orphan rows (avoids failing prod with legacy NULLs).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'event_id'
  ) AND NOT EXISTS (SELECT 1 FROM public.posts WHERE event_id IS NULL) THEN
    ALTER TABLE public.posts ALTER COLUMN event_id SET NOT NULL;
  END IF;
EXCEPTION
  WHEN others THEN
    -- Leave nullable if constraint cannot be applied (e.g. mixed schemas).
    NULL;
END $$;

-- ---------------------------------------------------------------------------
-- post_downloads: ensure helpful indexes (existing table may have extra audit columns)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_post_downloads_user_id
  ON public.post_downloads (user_id);

CREATE INDEX IF NOT EXISTS idx_post_downloads_post_id_only
  ON public.post_downloads (post_id);

CREATE INDEX IF NOT EXISTS idx_post_downloads_post_user_created
  ON public.post_downloads (post_id, user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- profiles: ensure core columns referenced by analytics / RBAC (additive only)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS name text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS state_id bigint;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS party_id bigint;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS group_id bigint;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_profiles_state_party
  ON public.profiles (state_id, party_id)
  WHERE state_id IS NOT NULL AND party_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_group_id
  ON public.profiles (group_id)
  WHERE group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON public.profiles (role);
