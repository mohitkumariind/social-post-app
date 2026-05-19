-- Phase 0: bare download ingestion (no visibility, dedupe, download_count, or analytics coupling).
-- Mobile calls record_post_download_simple only until ingestion is verified stable.

ALTER TABLE public.post_downloads
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_post_downloads_event_id_created
  ON public.post_downloads (event_id, created_at DESC)
  WHERE event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.record_post_download_simple(
  p_post_id uuid,
  p_action_type text DEFAULT 'save'
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_action text := coalesce(nullif(btrim(p_action_type), ''), 'save');
  v_event_id uuid;
  v_row public.post_downloads%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF v_action NOT IN ('save', 'whatsapp_share') THEN
    v_action := 'save';
  END IF;

  SELECT po.event_id
  INTO v_event_id
  FROM public.posts po
  WHERE po.id = p_post_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'post_not_found');
  END IF;

  INSERT INTO public.post_downloads (
    post_id,
    user_id,
    event_id,
    action_type,
    rendered_variant_hash
  )
  VALUES (
    p_post_id,
    auth.uid(),
    v_event_id,
    v_action,
    'simple-ingest-v1'
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'post_id', v_row.post_id,
    'user_id', v_row.user_id,
    'event_id', v_row.event_id,
    'created_at', v_row.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_post_download_simple(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_post_download_simple(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
