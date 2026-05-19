import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminAnalyticsScope } from '@/lib/admin/rbac';
import { scopeDeniesAllRows } from '@/lib/admin/rbac';

/**
 * RPC payload aligned with public.admin_campaign_analytics_* and admin_get_campaign_analytics (see migrations).
 * Keep in sync with lib/admin/rbac.ts scope semantics.
 */
export type CampaignAnalyticsRpcScope = {
  p_scope_mode: 'all' | 'moderator' | 'campaign_manager';
  p_moderator_state_ids: number[];
  p_cm_viewer: string | null;
  p_cm_profile_group_ids: number[];
  p_cm_event_group_text: string[];
};

export type CampaignTimeBucketStats = {
  /** UTC calendar day [00:00, now] capped at end of window. */
  today: number;
  /** Full previous UTC calendar day. */
  yesterday: number;
  /** Rolling last 168 hours ending now. */
  last7Days: number;
  /** Previous UTC calendar month (first instant → last instant). */
  lastMonth: number;
};

export type EventDownloadStatRow = {
  event_id: string;
  download_count: number;
};

export type NotDownloadedProfileRow = {
  profile_id: string;
  name: string | null;
  phone: string | null;
};

/** Event drilldown: not-downloaded users with labels (RPC `admin_event_users_not_downloaded_page`). */
export type EventNotDownloadedUserRow = {
  user_id: string;
  name: string | null;
  phone: string | null;
  state: string;
  group: string;
  last_active: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Maps AdminAnalyticsScope → RPC arguments (same contract as SQL CASE in migration). */
export function campaignAnalyticsRpcScope(scope: AdminAnalyticsScope): CampaignAnalyticsRpcScope {
  if (scope.kind === 'unrestricted') {
    return {
      p_scope_mode: 'all',
      p_moderator_state_ids: [],
      p_cm_viewer: null,
      p_cm_profile_group_ids: [],
      p_cm_event_group_text: [],
    };
  }
  if (scope.kind === 'moderator') {
    return {
      p_scope_mode: 'moderator',
      p_moderator_state_ids: [...scope.stateIds],
      p_cm_viewer: null,
      p_cm_profile_group_ids: [],
      p_cm_event_group_text: [],
    };
  }
  return {
    p_scope_mode: 'campaign_manager',
    p_moderator_state_ids: [],
    p_cm_viewer: scope.viewerId,
    p_cm_profile_group_ids: [...scope.profileGroupIds],
    p_cm_event_group_text: [...scope.groupIdsText],
  };
}

function clampDateRange(startDate: Date, endDate: Date): { fromIso: string; toIso: string } | { error: string } {
  const from = startDate instanceof Date && !Number.isNaN(startDate.getTime()) ? startDate : null;
  const to = endDate instanceof Date && !Number.isNaN(endDate.getTime()) ? endDate : null;
  if (!from || !to) return { error: 'Invalid date range' };
  if (from.getTime() > to.getTime()) return { error: 'startDate must be before or equal to endDate' };
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function utcStartOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function utcEndOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

async function rpcTotalPoints(
  admin: SupabaseClient,
  fromIso: string,
  toIso: string,
  rpc: CampaignAnalyticsRpcScope
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc('admin_campaign_analytics_total_points', {
    p_from: fromIso,
    p_to: toIso,
    p_scope_mode: rpc.p_scope_mode,
    p_moderator_state_ids: rpc.p_moderator_state_ids,
    p_cm_viewer: rpc.p_cm_viewer,
    p_cm_profile_group_ids: rpc.p_cm_profile_group_ids,
    p_cm_event_group_text: rpc.p_cm_event_group_text,
  });
  if (error) return { ok: false, error: error.message };
  const n = typeof data === 'number' ? data : Number(data ?? 0);
  return { ok: true, count: Number.isFinite(n) ? n : 0 };
}

/**
 * Total download rows (1 row = 1 point) in range, scoped via post_downloads → posts.event_id → events + downloader profiles.
 * Requires service-role Supabase client and deployed RPC (see migration admin_campaign_analytics_total_points).
 */
export async function getTotalPoints(
  admin: SupabaseClient,
  startDate: Date,
  endDate: Date,
  scope: AdminAnalyticsScope
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (scopeDeniesAllRows(scope)) return { ok: true, count: 0 };
  const range = clampDateRange(startDate, endDate);
  if ('error' in range) return { ok: false, error: range.error };
  return rpcTotalPoints(admin, range.fromIso, range.toIso, campaignAnalyticsRpcScope(scope));
}

/**
 * Per-event download totals (all time), scoped. Uses posts.event_id for event mapping.
 */
export async function getEventStats(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope
): Promise<{ ok: true; rows: EventDownloadStatRow[] } | { ok: false; error: string }> {
  if (scopeDeniesAllRows(scope)) return { ok: true, rows: [] };
  const rpc = campaignAnalyticsRpcScope(scope);
  const { data, error } = await admin.rpc('admin_campaign_analytics_event_download_stats', {
    p_scope_mode: rpc.p_scope_mode,
    p_moderator_state_ids: rpc.p_moderator_state_ids,
    p_cm_viewer: rpc.p_cm_viewer,
    p_cm_profile_group_ids: rpc.p_cm_profile_group_ids,
    p_cm_event_group_text: rpc.p_cm_event_group_text,
  });
  if (error) return { ok: false, error: error.message };
  if (!Array.isArray(data)) return { ok: true, rows: [] };
  const rows: EventDownloadStatRow[] = (data as Record<string, unknown>[]).map((r) => ({
    event_id: String(r.event_id ?? ''),
    download_count: Number(r.download_count ?? 0),
  }));
  return { ok: true, rows };
}

/**
 * Predefined windows (UTC): today (midnight→now), yesterday (full day), rolling 7d, previous calendar month.
 */
export async function getTimeBasedStats(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope
): Promise<{ ok: true; stats: CampaignTimeBucketStats } | { ok: false; error: string }> {
  const now = new Date();
  const startToday = utcStartOfDay(now);
  const startYesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0, 0));
  const endYesterday = utcEndOfDay(startYesterday);
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const mo = now.getUTCMonth();
  const prevMonth = mo === 0 ? 11 : mo - 1;
  const prevYear = mo === 0 ? y - 1 : y;
  const lastMonthStart = new Date(Date.UTC(prevYear, prevMonth, 1, 0, 0, 0, 0));
  const lastMonthEnd = new Date(Date.UTC(prevYear, prevMonth + 1, 0, 23, 59, 59, 999));

  const [todayR, yestR, d7R, lmR] = await Promise.all([
    getTotalPoints(admin, startToday, now, scope),
    getTotalPoints(admin, startYesterday, endYesterday, scope),
    getTotalPoints(admin, last7Start, now, scope),
    getTotalPoints(admin, lastMonthStart, lastMonthEnd, scope),
  ]);

  const fail = [todayR, yestR, d7R, lmR].find((r) => !r.ok) as { ok: false; error: string } | undefined;
  if (fail) return fail;

  return {
    ok: true,
    stats: {
      today: (todayR as { ok: true; count: number }).count,
      yesterday: (yestR as { ok: true; count: number }).count,
      last7Days: (d7R as { ok: true; count: number }).count,
      lastMonth: (lmR as { ok: true; count: number }).count,
    },
  };
}

/**
 * Profiles in RBAC scope for the event who have zero post_downloads for any post with posts.event_id = event_id.
 * Hard-capped server-side (default 10k, max 20k in RPC).
 */
export async function getNotDownloadedUsers(
  admin: SupabaseClient,
  eventId: string,
  scope: AdminAnalyticsScope,
  opts?: { limit?: number }
): Promise<{ ok: true; rows: NotDownloadedProfileRow[] } | { ok: false; error: string }> {
  const eid = String(eventId ?? '').trim();
  if (!UUID_RE.test(eid)) return { ok: false, error: 'Invalid event_id' };
  if (scopeDeniesAllRows(scope)) return { ok: true, rows: [] };
  const rpc = campaignAnalyticsRpcScope(scope);
  const lim = opts?.limit != null ? Math.min(Math.max(Number(opts.limit), 1), 20000) : 10000;
  const { data, error } = await admin.rpc('admin_campaign_analytics_not_downloaded_profiles', {
    p_event_id: eid,
    p_scope_mode: rpc.p_scope_mode,
    p_moderator_state_ids: rpc.p_moderator_state_ids,
    p_cm_viewer: rpc.p_cm_viewer,
    p_cm_profile_group_ids: rpc.p_cm_profile_group_ids,
    p_cm_event_group_text: rpc.p_cm_event_group_text,
    p_limit: lim,
  });
  if (error) return { ok: false, error: error.message };
  if (!Array.isArray(data)) return { ok: true, rows: [] };
  const rows: NotDownloadedProfileRow[] = (data as Record<string, unknown>[]).map((r) => ({
    profile_id: String(r.profile_id ?? ''),
    name: r.name == null ? null : String(r.name),
    phone: r.phone == null ? null : String(r.phone),
  }));
  return { ok: true, rows };
}

/**
 * Profiles in RBAC scope for `event_id` who never downloaded that event's posts.
 * Search and pagination are enforced in SQL. Phone is returned only for admin (`p_scope_mode = all`).
 */
export async function getEventNotDownloadedUsersPage(
  admin: SupabaseClient,
  eventId: string,
  scope: AdminAnalyticsScope,
  opts: {
    search?: string | null;
    offset: number;
    limit: number;
    dateFrom?: Date | null;
    dateTo?: Date | null;
  }
): Promise<{ ok: true; users: EventNotDownloadedUserRow[]; total: number } | { ok: false; error: string }> {
  const eid = String(eventId ?? '').trim();
  if (!UUID_RE.test(eid)) return { ok: false, error: 'Invalid event_id' };
  if (scopeDeniesAllRows(scope)) return { ok: true, users: [], total: 0 };
  const rpc = campaignAnalyticsRpcScope(scope);
  const lim = Math.min(200, Math.max(1, Math.trunc(Number(opts.limit)) || 50));
  const off = Math.min(50_000, Math.max(0, Math.trunc(Number(opts.offset)) || 0));
  const search = opts.search != null && String(opts.search).trim() !== '' ? String(opts.search).trim() : null;
  const downloadFrom = opts.dateFrom instanceof Date && !Number.isNaN(opts.dateFrom.getTime()) ? opts.dateFrom.toISOString() : null;
  const downloadTo = opts.dateTo instanceof Date && !Number.isNaN(opts.dateTo.getTime()) ? opts.dateTo.toISOString() : null;

  const { data, error } = await admin.rpc('admin_event_users_not_downloaded_page', {
    p_event_id: eid,
    p_scope_mode: rpc.p_scope_mode,
    p_moderator_state_ids: rpc.p_moderator_state_ids,
    p_cm_viewer: rpc.p_cm_viewer,
    p_cm_profile_group_ids: rpc.p_cm_profile_group_ids,
    p_cm_event_group_text: rpc.p_cm_event_group_text,
    p_download_from: downloadFrom,
    p_download_to: downloadTo,
    p_notify_from: downloadFrom,
    p_notify_to: downloadTo,
    p_search: search,
    p_offset: off,
    p_limit: lim,
  });
  if (error) return { ok: false, error: error.message };

  if (data != null && typeof data === 'object' && !Array.isArray(data) && 'rows' in data) {
    const payload = data as { total?: unknown; rows?: unknown };
    const total = Number(payload.total ?? 0);
    const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
    const users: EventNotDownloadedUserRow[] = (rawRows as Record<string, unknown>[]).map((r) => ({
      user_id: String(r.user_id ?? ''),
      name: r.name == null ? null : String(r.name),
      phone: r.phone == null ? null : String(r.phone),
      state: r.state == null ? '' : String(r.state),
      group: r.group == null ? '' : String(r.group),
      last_active:
        r.last_active == null || r.last_active === ''
          ? null
          : typeof r.last_active === 'string'
            ? r.last_active
            : String(r.last_active),
    }));
    return { ok: true, users, total: Number.isFinite(total) ? total : 0 };
  }

  return { ok: true, users: [], total: 0 };
}
