-- Optional editor party scope (slug ids matching PARTIES_DATA, e.g. 'bjp', 'inc').
-- Empty array = no restriction (all parties selectable).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS assigned_party_ids text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.profiles.assigned_party_ids IS
  'Editor/moderator optional party slug allowlist; empty means all parties allowed.';
