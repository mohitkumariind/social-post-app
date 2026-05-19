import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminAnalyticsScope } from '@/lib/admin/rbac';
import { scopeDeniesAllRows } from '@/lib/admin/rbac';
import { campaignAnalyticsRpcScope } from '@/lib/admin/analyticsService';

export type RawDownloadKpis = {
  today: number;
  yesterday: number;
  last7_days: number;
  last_30_days: number;
  current_month: number;
  last_month: number;
  all_time: number;
  range_count: number | null;
};

export type RawDownloadEventRow = {
  event_id: string;
  title: string;
  downloads: number;
  engaged_users: number;
};

function clampRange(from: Date, to: Date): { fromIso: string; toIso: string } | { error: string } {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: 'Invalid date range' };
  if (from.getTime() > to.getTime()) return { error: 'date_from must be before or equal to date_to' };
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

export async function fetchRawDownloadKpis(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  opts?: { dateFrom?: Date | null; dateTo?: Date | null }
): Promise<{ ok: true; data: RawDownloadKpis } | { ok: false; error: string }> {
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
        range_count: opts?.dateFrom && opts?.dateTo ? 0 : null,
      },
    };
  }

  const rpc = campaignAnalyticsRpcScope(scope);
  let rangeFrom: string | null = null;
  let rangeTo: string | null = null;
  if (opts?.dateFrom && opts?.dateTo) {
    const range = clampRange(opts.dateFrom, opts.dateTo);
    if ('error' in range) return { ok: false, error: range.error };
    rangeFrom = range.fromIso;
    rangeTo = range.toIso;
  }

  const { data, error } = await admin.rpc('admin_raw_download_kpis', {
    p_range_from: rangeFrom,
    p_range_to: rangeTo,
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
      range_count:
        payload.range_count === null || payload.range_count === undefined
          ? null
          : Number(payload.range_count ?? 0),
    },
  };
}

export async function fetchRawDownloadEventsPage(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  opts: {
    dateFrom: Date;
    dateTo: Date;
    search?: string | null;
    offset: number;
    limit: number;
  }
): Promise<{ ok: true; rows: RawDownloadEventRow[]; total: number } | { ok: false; error: string }> {
  if (scopeDeniesAllRows(scope)) return { ok: true, rows: [], total: 0 };

  const range = clampRange(opts.dateFrom, opts.dateTo);
  if ('error' in range) return { ok: false, error: range.error };

  const rpc = campaignAnalyticsRpcScope(scope);
  const search = opts.search != null && String(opts.search).trim() !== '' ? String(opts.search).trim() : null;
  const lim = Math.min(200, Math.max(1, Math.trunc(opts.limit) || 50));
  const off = Math.min(50_000, Math.max(0, Math.trunc(opts.offset) || 0));

  const { data, error } = await admin.rpc('admin_raw_download_events_page', {
    p_from: range.fromIso,
    p_to: range.toIso,
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
    const rows: RawDownloadEventRow[] = (rawRows as Record<string, unknown>[]).map((r) => ({
      event_id: String(r.event_id ?? ''),
      title: String(r.title ?? '—'),
      downloads: Number(r.downloads ?? 0),
      engaged_users: Number(r.engaged_users ?? 0),
    }));
    return { ok: true, rows, total: Number.isFinite(total) ? total : 0 };
  }

  return { ok: true, rows: [], total: 0 };
}
