-- Align profiles.role whitelist with production roles (worker, moderator, user, admin) + editor.
-- Roles are TEXT + CHECK (not ENUM). Keeps legacy super_admin / campaign_manager for existing deployments.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'role'
  ) THEN
    ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_whitelist;
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_whitelist
      CHECK (
        role IN (
          'worker',
          'moderator',
          'user',
          'admin',
          'editor',
          'super_admin',
          'campaign_manager'
        )
      )
      NOT VALID;
  END IF;
END $$;
