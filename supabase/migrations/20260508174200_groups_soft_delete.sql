-- Groups soft delete (core entity)

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_groups_deleted_at
  ON public.groups (deleted_at);

