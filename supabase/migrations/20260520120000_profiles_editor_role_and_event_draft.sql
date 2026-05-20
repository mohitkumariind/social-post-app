-- Editor role (create-event-only admin) + draft event status for editor submissions.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_whitelist;
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_whitelist
      CHECK (role IN ('user', 'admin', 'super_admin', 'moderator', 'campaign_manager', 'editor'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_status_whitelist;
    ALTER TABLE public.events
      ADD CONSTRAINT events_status_whitelist
      CHECK (
        status IN (
          'draft',
          'published',
          'scheduled_publish',
          'processing_publish',
          'archived',
          'scheduled_publish_failed'
        )
      )
      NOT VALID;
  END IF;
END $$;
