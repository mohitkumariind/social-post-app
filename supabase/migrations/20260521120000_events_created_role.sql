-- Event ownership metadata for cross-role RBAC visibility (moderator / CM / editor).

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS created_role TEXT;

COMMENT ON COLUMN public.events.created_role IS
  'Admin panel role of creator at insert time (admin, moderator, campaign_manager, editor).';

UPDATE public.events e
SET created_role = p.role
FROM public.profiles p
WHERE e.created_role IS NULL
  AND e.created_by IS NOT NULL
  AND p.id = e.created_by
  AND p.role IN ('admin', 'super_admin', 'moderator', 'campaign_manager', 'editor');

-- Orphans without matching profile remain NULL (fail-closed; no false cross-role visibility).
