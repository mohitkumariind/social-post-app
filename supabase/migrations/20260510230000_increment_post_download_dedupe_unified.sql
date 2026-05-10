-- Align increment_post_download with unified dedupe (deployed): same user+post+variant within 1h,
-- regardless of action_type (save vs whatsapp_share still stored on rows for audit).

CREATE OR REPLACE FUNCTION public.increment_post_download(
  p_post_id uuid,
  p_action_type text,
  p_rendered_variant_hash text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visible boolean;
  v_dup boolean;
  v_hash text := btrim(coalesce(p_rendered_variant_hash, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_action_type IS NULL OR p_action_type NOT IN ('save', 'whatsapp_share') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_action');
  END IF;

  IF length(v_hash) < 16 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_hash');
  END IF;

  SELECT public.dashboard_post_id_visible_for_rls(p_post_id::text) INTO v_visible;
  IF NOT coalesce(v_visible, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.post_downloads d
    WHERE d.user_id = auth.uid()
      AND d.post_id = p_post_id
      AND d.rendered_variant_hash = v_hash
      AND d.created_at > (now() - interval '1 hour')
  ) INTO v_dup;

  IF v_dup THEN
    RETURN jsonb_build_object('ok', true, 'deduped', true);
  END IF;

  INSERT INTO public.post_downloads (post_id, user_id, action_type, rendered_variant_hash)
  VALUES (p_post_id, auth.uid(), p_action_type, v_hash);

  UPDATE public.posts
  SET download_count = coalesce(download_count, 0) + 1
  WHERE id = p_post_id;

  RETURN jsonb_build_object('ok', true, 'deduped', false);
END;
$$;

DROP INDEX IF EXISTS public.idx_post_downloads_user_post_variant_action_cooldown;

CREATE INDEX IF NOT EXISTS idx_post_downloads_user_post_variant_cooldown
  ON public.post_downloads (user_id, post_id, rendered_variant_hash, created_at DESC);
