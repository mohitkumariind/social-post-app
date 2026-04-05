-- SocialBot admin gate: middleware checks profiles.role = 'admin'
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

COMMENT ON COLUMN public.profiles.role IS 'Access level: user (default) or admin (SocialBot). Set admin via SQL: UPDATE profiles SET role = ''admin'' WHERE id = ''<uuid>'';';
