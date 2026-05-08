-- Campaign manager group assignment support (parallel to assigned_state_ids)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS assigned_group_ids TEXT[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_profiles_assigned_group_ids
  ON public.profiles USING GIN (assigned_group_ids);

