-- Allow many-to-many user <-> group membership (replaces single profiles.group_id usage over time)
CREATE TABLE IF NOT EXISTS public.group_memberships (
  group_id BIGINT NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_memberships_user_id
  ON public.group_memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_group_memberships_group_id
  ON public.group_memberships (group_id);

