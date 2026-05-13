-- Phase 5: per-user unseen variant assignments at wave execution (not at publish).

CREATE TABLE IF NOT EXISTS public.twitter_campaign_user_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.twitter_campaigns (id) ON DELETE CASCADE,
  wave_id uuid NOT NULL REFERENCES public.twitter_campaign_waves (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.twitter_campaign_variants (id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'assigned',
  CONSTRAINT twitter_campaign_user_assignments_status_check
    CHECK (status IN ('assigned', 'delivered', 'cancelled')),
  CONSTRAINT twitter_campaign_user_assignments_uq_user_campaign_variant
    UNIQUE (user_id, campaign_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_twitter_campaign_user_assignments_campaign_user
  ON public.twitter_campaign_user_assignments (campaign_id, user_id);

CREATE INDEX IF NOT EXISTS idx_twitter_campaign_user_assignments_wave
  ON public.twitter_campaign_user_assignments (wave_id);

CREATE INDEX IF NOT EXISTS idx_twitter_campaign_user_assignments_variant
  ON public.twitter_campaign_user_assignments (variant_id);

ALTER TABLE public.twitter_campaign_user_assignments ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Bulk assign: for each user, pick lowest variant_index not already assigned
-- for this campaign (any wave). Skips users with no unseen variants left.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.twitter_campaign_assign_unseen_for_users(
  p_wave_id uuid,
  p_campaign_id uuid,
  p_user_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  uid uuid;
  v_id uuid;
  n_inserted int := 0;
  n_skipped_exhausted int := 0;
  n_skipped_duplicate int := 0;
BEGIN
  IF p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN
    RETURN jsonb_build_object(
      'inserted', 0,
      'skipped_exhausted', 0,
      'skipped_duplicate', 0
    );
  END IF;

  FOREACH uid IN ARRAY p_user_ids
  LOOP
    v_id := NULL;
    SELECT v.id
    INTO v_id
    FROM public.twitter_campaign_variants v
    WHERE v.campaign_id = p_campaign_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.twitter_campaign_user_assignments a
        WHERE a.user_id = uid
          AND a.campaign_id = p_campaign_id
          AND a.variant_id = v.id
      )
    ORDER BY v.variant_index ASC NULLS LAST
    LIMIT 1;

    IF v_id IS NULL THEN
      n_skipped_exhausted := n_skipped_exhausted + 1;
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.twitter_campaign_user_assignments (
        campaign_id,
        wave_id,
        user_id,
        variant_id,
        status
      )
      VALUES (p_campaign_id, p_wave_id, uid, v_id, 'assigned');
      n_inserted := n_inserted + 1;
    EXCEPTION
      WHEN unique_violation THEN
        n_skipped_duplicate := n_skipped_duplicate + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted', n_inserted,
    'skipped_exhausted', n_skipped_exhausted,
    'skipped_duplicate', n_skipped_duplicate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.twitter_campaign_assign_unseen_for_users(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twitter_campaign_assign_unseen_for_users(uuid, uuid, uuid[]) TO service_role;
