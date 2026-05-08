-- RBAC Observability (non-blocking security intelligence)
CREATE TABLE IF NOT EXISTS public.rbac_observability_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  event_type TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NULL,
  result TEXT NOT NULL CHECK (result IN ('allowed','denied')),
  scope_state_ids BIGINT[] NOT NULL DEFAULT '{}'::bigint[],
  scope_group_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rbac_obs_user_created_at
  ON public.rbac_observability_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rbac_obs_role_created_at
  ON public.rbac_observability_events (role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rbac_obs_event_type_created_at
  ON public.rbac_observability_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rbac_obs_severity_created_at
  ON public.rbac_observability_events (severity, created_at DESC);

