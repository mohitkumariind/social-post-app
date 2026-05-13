-- Twitter Campaign Phase 4: wave worker (lease + staging batches). No notifications / unseen logic here.

-- ---------------------------------------------------------------------------
-- profiles.party: optional text slug used for campaign targeting (mobile edit-profile).
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS party text;

CREATE INDEX IF NOT EXISTS idx_profiles_party_lower
  ON public.profiles (lower(btrim(party)))
  WHERE party IS NOT NULL AND btrim(party) <> '';

-- ---------------------------------------------------------------------------
-- twitter_campaign_waves: worker lease + staging cursor + terminal timestamps
-- ---------------------------------------------------------------------------
ALTER TABLE public.twitter_campaign_waves
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by text,
  ADD COLUMN IF NOT EXISTS lock_token text,
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS staging_after_user_id uuid;

ALTER TABLE public.twitter_campaign_waves
  ALTER COLUMN attempt_count SET DEFAULT 0;

ALTER TABLE public.twitter_campaign_waves
  DROP CONSTRAINT IF EXISTS twitter_campaign_waves_status_check;

ALTER TABLE public.twitter_campaign_waves
  ADD CONSTRAINT twitter_campaign_waves_status_check
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_twitter_campaign_waves_pending_scheduled
  ON public.twitter_campaign_waves (scheduled_at ASC, id ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_twitter_campaign_waves_running_lease
  ON public.twitter_campaign_waves (locked_at ASC, id ASC)
  WHERE status = 'running';

-- ---------------------------------------------------------------------------
-- Wave batches: scalable fan-out units (assignment processing comes later).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.twitter_campaign_wave_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id uuid NOT NULL REFERENCES public.twitter_campaign_waves (id) ON DELETE CASCADE,
  batch_index int NOT NULL,
  status text NOT NULL DEFAULT 'prepared',
  profile_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twitter_campaign_wave_batches_status_check
    CHECK (status IN ('prepared', 'processing', 'completed', 'failed')),
  CONSTRAINT twitter_campaign_wave_batches_unique_index UNIQUE (wave_id, batch_index),
  CONSTRAINT twitter_campaign_wave_batches_index_positive CHECK (batch_index >= 1)
);

CREATE INDEX IF NOT EXISTS idx_twitter_campaign_wave_batches_wave
  ON public.twitter_campaign_wave_batches (wave_id, batch_index);

ALTER TABLE public.twitter_campaign_wave_batches ENABLE ROW LEVEL SECURITY;
