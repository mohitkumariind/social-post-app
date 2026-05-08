-- Posts scheduling support (minimal schema change)
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

