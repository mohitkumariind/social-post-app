-- RBAC visibility / scoping query paths (events listings, overlap filters).

CREATE INDEX IF NOT EXISTS idx_events_created_role_created_by
  ON public.events (created_role, created_by)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_state_id_gin
  ON public.events USING gin (state_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_target_groups_gin
  ON public.events USING gin (target_groups)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_party_id_gin
  ON public.events USING gin (party_id)
  WHERE deleted_at IS NULL AND party_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_posts_created_by_event
  ON public.posts (created_by, event_id)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_events_state_id_gin IS 'Moderator/event list overlap filters on state_id arrays.';
COMMENT ON INDEX idx_events_target_groups_gin IS 'Campaign manager target_groups containedBy scoping.';
