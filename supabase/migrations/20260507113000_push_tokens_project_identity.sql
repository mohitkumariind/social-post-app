-- Harden push token architecture:
-- - persist Expo EAS project identity for each token
-- - persist platform and timestamps
-- - enable grouping by project_id before sending (prevents mixed-project request failures)

ALTER TABLE public.push_tokens
  ADD COLUMN IF NOT EXISTS project_id text,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Ensure updated_at exists and has a default (older installs already have it).
ALTER TABLE public.push_tokens
  ALTER COLUMN updated_at SET DEFAULT now();

-- Helpful index for grouping/sending and cleanup operations.
CREATE INDEX IF NOT EXISTS idx_push_tokens_project_id ON public.push_tokens (project_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_token ON public.push_tokens (token);

