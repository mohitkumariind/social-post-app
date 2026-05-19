-- Add calendar-month KPI buckets: current_month, last_month (UTC).
-- Keeps rolling last_30_days separate from calendar last_month.

CREATE OR REPLACE FUNCTION public.admin_raw_download_kpis(
  p_range_from timestamptz,
  p_range_to timestamptz,
  p_scope_mode text,
  p_moderator_state_ids bigint[],
  p_cm_viewer uuid,
  p_cm_profile_group_ids bigint[],
  p_cm_event_group_text text[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_now timestamptz := now();
  v_start_today timestamptz := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_start_yesterday timestamptz := v_start_today - interval '1 day';
  v_end_yesterday timestamptz := v_start_today - interval '1 microsecond';
  v_start_7d timestamptz := v_now - interval '7 days';
  v_start_30d timestamptz := v_now - interval '30 days';
  v_start_current_month timestamptz :=
    date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_start_last_month timestamptz :=
    (date_trunc('month', (v_now AT TIME ZONE 'UTC')::timestamp) - interval '1 month') AT TIME ZONE 'UTC';
  v_end_last_month timestamptz := v_start_current_month - interval '1 microsecond';
  v_epoch timestamptz := '2000-01-01T00:00:00Z'::timestamptz;
BEGIN
  RETURN jsonb_build_object(
    'today',
      public.admin_raw_download_count_scoped(
        v_start_today, v_now,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'yesterday',
      public.admin_raw_download_count_scoped(
        v_start_yesterday, v_end_yesterday,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'last7_days',
      public.admin_raw_download_count_scoped(
        v_start_7d, v_now,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'last_30_days',
      public.admin_raw_download_count_scoped(
        v_start_30d, v_now,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'current_month',
      public.admin_raw_download_count_scoped(
        v_start_current_month, v_now,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'last_month',
      public.admin_raw_download_count_scoped(
        v_start_last_month, v_end_last_month,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'all_time',
      public.admin_raw_download_count_scoped(
        v_epoch, v_now,
        p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
      ),
    'range_count',
      CASE
        WHEN p_range_from IS NOT NULL AND p_range_to IS NOT NULL THEN
          public.admin_raw_download_count_scoped(
            p_range_from, p_range_to,
            p_scope_mode, p_moderator_state_ids, p_cm_viewer, p_cm_profile_group_ids, p_cm_event_group_text
          )
        ELSE NULL::bigint
      END
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
