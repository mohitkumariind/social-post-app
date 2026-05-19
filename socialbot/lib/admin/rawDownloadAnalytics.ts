import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminAnalyticsScope } from '@/lib/admin/rbac';
import { scopeDeniesAllRows } from '@/lib/admin/rbac';
import { campaignAnalyticsRpcScope } from '@/lib/admin/analyticsService';

export type AnalyticsTimeBuckets = {
  today: number;
  yesterday: number;
  last7_days: number;
  last_30_days: number;
  current_month: number;
  last_month: number;
  all_time: number;
};

export type AnalyticsKpisRpcResult = {
  engaged_users: AnalyticsTimeBuckets;
  raw_downloads: AnalyticsTimeBuckets;
};

export type EventMetrics7dRow = {
  event_id: string;
  title: string;
  posts: number;
  raw_downloads: number;
  engaged_users: number;
};

export type AnalyticsGeoFilters = {
  stateId: number | null;
  party: string | null;
};

function parseBuckets(payload: Record<string, unknown> | undefined): AnalyticsTimeBuckets {
  const p = payload ?? {};
  return {
    today: Number(p.today ?? 0),
    yesterday: Number(p.yesterday ?? 0),
    last7_days: Number(p.last7_days ?? 0),
    last_30_days: Number(p.last_30_days ?? 0),
    current_month: Number(p.current_month ?? 0),
    last_month: Number(p.last_month ?? 0),
    all_time: Number(p.all_time ?? 0),
  };
}

const EMPTY_BUCKETS: AnalyticsTimeBuckets = {
  today: 0,
  yesterday: 0,
  last7_days: 0,
  last_30_days: 0,
  current_month: 0,
  last_month: 0,
  all_time: 0,
};

export async function fetchAnalyticsKpisRpc(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  filters: AnalyticsGeoFilters
): Promise<{ ok: true; data: AnalyticsKpisRpcResult } | { ok: false; error: string }> {
  if (scopeDeniesAllRows(scope)) {
    return {
      ok: true,
      data: { engaged_users: { ...EMPTY_BUCKETS }, raw_downloads: { ...EMPTY_BUCKETS } },
    };
  }

  const rpc = campaignAnalyticsRpcScope(scope);
  const { data, error } = await admin.rpc('admin_engaged_users_kpis', {
    p_scope_mode: rpc.p_scope_mode,
    p_moderator_state_ids: rpc.p_moderator_state_ids,
    p_cm_viewer: rpc.p_cm_viewer,
    p_cm_profile_group_ids: rpc.p_cm_profile_group_ids,
    p_cm_event_group_text: rpc.p_cm_event_group_text,
    p_filter_state_id: filters.stateId,
    p_filter_party: filters.party,
  });

  if (error) return { ok: false, error: error.message };

  const payload = data != null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const eu = payload.engaged_users;
  const rd = payload.raw_downloads;

  return {
    ok: true,
    data: {
      engaged_users: parseBuckets(
        eu != null && typeof eu === 'object' && !Array.isArray(eu) ? (eu as Record<string, unknown>) : undefined
      ),
      raw_downloads: parseBuckets(
        rd != null && typeof rd === 'object' && !Array.isArray(rd) ? (rd as Record<string, unknown>) : undefined
      ),
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
    filters: AnalyticsGeoFilters;
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
    p_filter_state_id: opts.filters.stateId,
    p_filter_party: opts.filters.party,
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

export async function fetchDistinctPartiesForState(
  admin: SupabaseClient,
  stateId: number | null
): Promise<{ ok: true; parties: { id: string; label: string }[] } | { ok: false; error: string }> {
  if (stateId == null || !Number.isFinite(stateId)) {
    return { ok: true, parties: [] };
  }
  const { data, error } = await admin
    .from('profiles')
    .select('party')
    .eq('state_id', stateId)
    .not('party', 'is', null)
    .limit(5000);
  if (error) return { ok: false, error: error.message };
  const seen = new Set<string>();
  const parties: { id: string; label: string }[] = [];
  for (const row of data ?? []) {
    const id = String((row as { party?: unknown }).party ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    parties.push({ id, label: id });
  }
  parties.sort((a, b) => a.label.localeCompare(b.label));
  return { ok: true, parties };
}
