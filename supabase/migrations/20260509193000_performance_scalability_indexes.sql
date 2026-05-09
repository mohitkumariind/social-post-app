-- Performance/scalability indexes for high-volume admin and worker paths.
-- Additive and safe: no behavioral changes.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Profiles admin search (`name.ilike`, `phone.ilike`) at scale.
CREATE INDEX IF NOT EXISTS idx_profiles_name_trgm
  ON public.profiles USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_phone_trgm
  ON public.profiles USING GIN (phone gin_trgm_ops);

-- Admin list pagination paths.
CREATE INDEX IF NOT EXISTS idx_profiles_created_at_desc
  ON public.profiles (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_events_created_at_desc_active
  ON public.events (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- User frames admin fetch (`where user_id = ? order by created_at desc`).
CREATE INDEX IF NOT EXISTS idx_user_frames_user_created_at_desc
  ON public.user_frames (user_id, created_at DESC);

-- Observability overview/count paths by time + dimensions.
CREATE INDEX IF NOT EXISTS idx_rbac_obs_created_result
  ON public.rbac_observability_events (created_at DESC, result);

CREATE INDEX IF NOT EXISTS idx_rbac_obs_created_role
  ON public.rbac_observability_events (created_at DESC, role);

-- Notifications history cleanup/read-window support.
CREATE INDEX IF NOT EXISTS idx_notifications_history_created_at_desc
  ON public.notifications_history (created_at DESC);
