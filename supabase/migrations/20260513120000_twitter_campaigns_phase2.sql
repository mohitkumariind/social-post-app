-- Twitter Campaign system (Phase 2): schema + atomic publish (wave generation only).
-- Admin APIs use the Supabase service role; RLS default-deny for direct client access.

-- ---------------------------------------------------------------------------
-- twitter_campaigns
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.twitter_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  type text NOT NULL,
  total_waves int NOT NULL,
  gap_minutes int NOT NULL,
  scheduled_at timestamptz,
  target_party text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twitter_campaigns_type_check CHECK (type IN ('tweet', 'retweet')),
  CONSTRAINT twitter_campaigns_status_check CHECK (status IN ('draft', 'published', 'cancelled')),
  CONSTRAINT twitter_campaigns_total_waves_check CHECK (total_waves >= 1),
  CONSTRAINT twitter_campaigns_gap_minutes_check CHECK (gap_minutes >= 0)
);

CREATE INDEX IF NOT EXISTS idx_twitter_campaigns_created_at
  ON public.twitter_campaigns (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_twitter_campaigns_created_by
  ON public.twitter_campaigns (created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_twitter_campaigns_status
  ON public.twitter_campaigns (status, created_at DESC);

ALTER TABLE public.twitter_campaigns ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_twitter_campaigns_updated_at ON public.twitter_campaigns;
CREATE TRIGGER trg_twitter_campaigns_updated_at
BEFORE UPDATE ON public.twitter_campaigns
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at_timestamp();

-- ---------------------------------------------------------------------------
-- twitter_campaign_variants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.twitter_campaign_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.twitter_campaigns (id) ON DELETE CASCADE,
  variant_index int NOT NULL,
  text text,
  image_url text,
  tweet_url text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twitter_campaign_variants_index_positive CHECK (variant_index >= 1),
  CONSTRAINT twitter_campaign_variants_unique_per_campaign UNIQUE (campaign_id, variant_index)
);

CREATE INDEX IF NOT EXISTS idx_twitter_campaign_variants_campaign
  ON public.twitter_campaign_variants (campaign_id, variant_index);

ALTER TABLE public.twitter_campaign_variants ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- twitter_campaign_waves
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.twitter_campaign_waves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.twitter_campaigns (id) ON DELETE CASCADE,
  wave_index int NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT twitter_campaign_waves_index_positive CHECK (wave_index >= 1),
  CONSTRAINT twitter_campaign_waves_status_check CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  CONSTRAINT twitter_campaign_waves_unique_per_campaign UNIQUE (campaign_id, wave_index)
);

CREATE INDEX IF NOT EXISTS idx_twitter_campaign_waves_campaign
  ON public.twitter_campaign_waves (campaign_id, wave_index);

CREATE INDEX IF NOT EXISTS idx_twitter_campaign_waves_scheduled
  ON public.twitter_campaign_waves (status, scheduled_at);

ALTER TABLE public.twitter_campaign_waves ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Atomic publish: draft -> published, insert wave rows (execution deferred).
-- Wave 1 at transaction time; wave k at +(k-1)*gap_minutes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.twitter_campaign_publish(p_campaign_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  c public.twitter_campaigns%ROWTYPE;
  i int;
  base timestamptz := now();
BEGIN
  SELECT *
  INTO c
  FROM public.twitter_campaigns
  WHERE id = p_campaign_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'twitter_campaign_not_found';
  END IF;

  IF c.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'twitter_campaign_publish_conflict:%', c.status;
  END IF;

  DELETE FROM public.twitter_campaign_waves w WHERE w.campaign_id = p_campaign_id;

  FOR i IN 1..c.total_waves LOOP
    INSERT INTO public.twitter_campaign_waves (campaign_id, wave_index, scheduled_at, status)
    VALUES (
      p_campaign_id,
      i,
      base + make_interval(mins => (i - 1) * c.gap_minutes),
      'pending'
    );
  END LOOP;

  UPDATE public.twitter_campaigns
  SET status = 'published', updated_at = now()
  WHERE id = p_campaign_id;
END;
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_publish(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_publish(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Replace all variants for a campaign (atomic). Used by admin APIs (service role).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.twitter_campaign_replace_variants(p_campaign_id uuid, p_variants jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  DELETE FROM public.twitter_campaign_variants v WHERE v.campaign_id = p_campaign_id;

  IF p_variants IS NULL OR jsonb_typeof(p_variants) <> 'array' OR jsonb_array_length(p_variants) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.twitter_campaign_variants (campaign_id, variant_index, text, image_url, tweet_url, note)
  SELECT
    p_campaign_id,
    CASE
      WHEN elem ? 'variant_index' AND nullif(btrim(elem->>'variant_index'), '') IS NOT NULL THEN (elem->>'variant_index')::int
      ELSE seq::int
    END,
    NULLIF(btrim(elem->>'text'), ''),
    NULLIF(btrim(elem->>'image_url'), ''),
    NULLIF(btrim(elem->>'tweet_url'), ''),
    NULLIF(btrim(elem->>'note'), '')
  FROM jsonb_array_elements(p_variants) WITH ORDINALITY AS t(elem, seq);
END;
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_replace_variants(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_replace_variants(uuid, jsonb) TO service_role;
