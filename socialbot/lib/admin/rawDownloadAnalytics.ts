import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminAnalyticsScope } from '@/lib/admin/rbac';
import { scopeDeniesAllRows } from '@/lib/admin/rbac';
import { campaignAnalyticsRpcScope } from '@/lib/admin/analyticsService';

/** Global unique engaged users (COUNT DISTINCT user_id) per UTC time window. */
export type EngagedUsersKpis = {
  today: number;
  yesterday: number;
  last7_days: number;
  last_30_days: number;
  current_month: number;
  last_month: number;
  all_time: number;
};

/** Per-event metrics for the rolling last 7 days (UTC). */
export type EventMetrics7dRow = {
  event_id: string;
  title: string;
  posts: number;
  raw_downloads: number;
  engaged_users: number;
};

export async function fetchEngagedUsersKpis(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope
): Promise<{ ok: true; data: EngagedUsersKpis } | { ok: false; error: string }> {
  if (scopeDeniesAllRows(scope)) {
    return {
      ok: true,
      data: {
        today: 0,
        yesterday: 0,
        last7_days: 0,
        last_30_days: 0,
        current_month: 0,
        last_month: 0,
        all_time: 0,
      },
    };
  }

  const rpc = campaignAnalyticsRpcScope(scope);
  const { data, error } = await admin.rpc('admin_engaged_users_kpis', {
    p_scope_mode: rpc.p_scope_mode,
    p_moderator_state_ids: rpc.p_moderator_state_ids,
    p_cm_viewer: rpc.p_cm_viewer,
    p_cm_profile_group_ids: rpc.p_cm_profile_group_ids,
    p_cm_event_group_text: rpc.p_cm_event_group_text,
  });

  if (error) return { ok: false, error: error.message };

  const payload = data != null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};

  return {
    ok: true,
    data: {
      today: Number(payload.today ?? 0),
      yesterday: Number(payload.yesterday ?? 0),
      last7_days: Number(payload.last7_days ?? 0),
      last_30_days: Number(payload.last_30_days ?? 0),
      current_month: Number(payload.current_month ?? 0),
      last_month: Number(payload.last_month ?? 0),
      all_time: Number(payload.all_time ?? 0),
    },
  };
}

export async function fetchEventMetrics7dPage(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  opts: {
    search?: string | null;
    offset: number;
    limit: number;
  }
): Promise<{ ok: true; rows: EventMetrics7dRow[]; total: number } | { ok: false; error: string }> {
  if (scopeDeniesAllRows(scope)) return { ok: true, rows: [], total: 0 };

  const rpc = campaignAnalyticsRpcScope(scope);
  const search = opts.search != null && String(opts.search).trim() !== '' ? String(opts.search).trim() : null;
  const lim = Math.min(200, Math.max(1, Math.trunc(opts.limit) || 50));
  const off = Math.min(50_000, Math.max(0, Math.trunc(opts.offset) || 0));

  const { data, error } = await admin.rpc('admin_event_metrics_7d_page', {
    p_scope_mode: rpc.p_scope_mode,
    p_moderator_state_ids: rpc.p_moderator_state_ids,
    p_cm_viewer: rpc.p_cm_viewer,
    p_cm_profile_group_ids: rpc.p_cm_profile_group_ids,
    p_cm_event_group_text: rpc.p_cm_event_group_text,
    p_search: search,
    p_offset: off,
    p_limit: lim,
  });

  if (error) return { ok: false, error: error.message };

  if (data != null && typeof data === 'object' && !Array.isArray(data) && 'rows' in data) {
    const payload = data as { total?: unknown; rows?: unknown };
    const total = Number(payload.total ?? 0);
    const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
    const rows: EventMetrics7dRow[] = (rawRows as Record<string, unknown>[]).map((r) => ({
      event_id: String(r.event_id ?? ''),
      title: String(r.title ?? '—'),
      posts: Number(r.posts ?? 0),
      raw_downloads: Number(r.raw_downloads ?? 0),
      engaged_users: Number(r.engaged_users ?? 0),
    }));
    return { ok: true, rows, total: Number.isFinite(total) ? total : 0 };
  }

  return { ok: true, rows: [], total: 0 };
}
