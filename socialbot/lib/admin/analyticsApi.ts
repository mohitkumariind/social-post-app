import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';
import { isCampaignManager } from '@/lib/admin-gate';
import type { AdminAnalyticsScope } from '@/lib/admin/rbac';
import { getScopedFilters, toAdminAnalyticsUserContext } from '@/lib/admin/rbac';
import { fetchRawDownloadEventsPage, fetchRawDownloadKpis } from '@/lib/admin/rawDownloadAnalytics';
import {
  getEventNotDownloadedUsersPage,
  type EventNotDownloadedUserRow,
} from '@/lib/admin/analyticsService';
import { resolveEffectiveGroupIdsForCampaignManager } from '@/lib/rbac/scoped-query-builder';
import { API_DEFAULT_LIMIT, API_MAX_LIMIT, clampLimit } from '@/lib/perf-defaults';

/** Max rows returned to clients for event / not-downloaded lists (after RPC + merge). */
export const ADMIN_ANALYTICS_LIST_CAP = 20_000;
export const ADMIN_ANALYTICS_MAX_OFFSET = 50_000;
export const ADMIN_ANALYTICS_EXPORT_MAX_ROWS = 10_000;

export type AnalyticsKpisPayload = {
  all_time: { total_points: number };
  /** Present when both `date_from` and `date_to` are valid. */
  range: { date_from: string; date_to: string; total_points: number } | null;
  time_buckets: {
    today: number;
    yesterday: number;
    last7Days: number;
    last30Days: number;
    currentMonth: number;
    lastMonth: number;
  };
};

export type AnalyticsEventPerformanceRow = {
  event_id: string;
  download_count: number;
  /** Display label from events.name / title (never raw table rows). */
  title: string;
};

export type PaginatedMeta = {
  total: number;
  offset: number;
  limit: number;
};

export type AnalyticsEventsResponse = {
  rows: AnalyticsEventPerformanceRow[];
  pagination: PaginatedMeta;
};

export type AnalyticsNotDownloadedRow = {
  profile_id: string;
  name: string | null;
  phone: string | null;
};

export type AnalyticsNotDownloadedResponse = {
  rows: AnalyticsNotDownloadedRow[];
  pagination: PaginatedMeta;
};

/** Event-level campaign intelligence row (API / export shape). */
export type CampaignIntelligenceApiEventRow = {
  /** `null` = global bucket from SQL; any other value = event-linked row. */
  event_id: string | null;
  title: string;
  /** Raw graphic download rows in range. */
  raw_downloads: number;
  /** Distinct users engaged (≥1 download) in range. */
  engaged_users: number;
  sent: number;
  delivered: number;
  opened: number;
  not_downloaded: number;
  open_rate: number | null;
  download_rate: number | null;
};

export type CampaignIntelligenceApiPayload = {
  events: CampaignIntelligenceApiEventRow[];
  total: number;
};

export type EventUsersNotDownloadedResponse = {
  users: EventNotDownloadedUserRow[];
  total: number;
  offset: number;
  limit: number;
};

function csvEscapeCell(v: string): string {
  const s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) return `'${s.replace(/'/g, "''")}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeSearch(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

function parseIsoDate(s: string | null | undefined): Date | null {
  if (s == null || String(s).trim() === '') return null;
  const d = new Date(String(s));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseOffset(raw: string | null | undefined): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.trunc(n), ADMIN_ANALYTICS_MAX_OFFSET);
}

/**
 * Resolves campaign-manager effective groups server-side, then builds {@link AdminAnalyticsScope}
 * (same rules as `lib/admin/rbac.ts`).
 */
export async function resolveAdminAnalyticsScope(
  admin: SupabaseClient,
  session: VerifiedAdminAuth
): Promise<{ ok: true; scope: AdminAnalyticsScope } | { ok: false; error: string; status: number }> {
  let effective_group_ids: string[] | undefined;
  if (isCampaignManager(session)) {
    const eff = await resolveEffectiveGroupIdsForCampaignManager(admin, session.user.id, session.assigned_group_ids);
    if (eff === null) {
      return { ok: false, error: 'Unable to resolve group assignments', status: 500 };
    }
    if (eff.length === 0) {
      return { ok: false, error: 'Campaign manager is missing assigned groups', status: 403 };
    }
    effective_group_ids = eff;
  }
  const ctx = toAdminAnalyticsUserContext(session, { effective_group_ids });
  return { ok: true, scope: getScopedFilters(ctx) };
}

/**
 * Phase 1: raw download KPIs — COUNT(post_downloads) by created_at only (see admin_raw_download_kpis).
 */
export async function fetchAnalyticsKpis(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  opts?: { dateFrom?: Date | null; dateTo?: Date | null }
): Promise<{ ok: true; data: AnalyticsKpisPayload } | { ok: false; error: string }> {
  const from = opts?.dateFrom ?? null;
  const to = opts?.dateTo ?? null;
  const result = await fetchRawDownloadKpis(admin, scope, { dateFrom: from, dateTo: to });
  if (!result.ok) return { ok: false, error: result.error };

  let range: AnalyticsKpisPayload['range'] = null;
  if (from && to && result.data.range_count != null) {
    range = {
      date_from: from.toISOString(),
      date_to: to.toISOString(),
      total_points: result.data.range_count,
    };
  }

  return {
    ok: true,
    data: {
      all_time: { total_points: result.data.all_time },
      range,
      time_buckets: {
        today: result.data.today,
        yesterday: result.data.yesterday,
        last7Days: result.data.last7_days,
        last30Days: result.data.last_30_days,
        currentMonth: result.data.current_month,
        lastMonth: result.data.last_month,
      },
    },
  };
}

/**
 * Per-event raw downloads and unique engaged users (post_downloads → posts → events, dashboard_category excluded).
 */
export async function fetchCampaignIntelligencePage(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  opts: {
    dateFrom: Date | null;
    dateTo: Date | null;
    eventId?: string | null;
    search?: string | null;
    offset: number;
    limit: number;
  }
): Promise<{ ok: true; data: CampaignIntelligenceApiPayload } | { ok: false; error: string }> {
  if (!opts.dateFrom || !opts.dateTo) {
    return { ok: false, error: 'date_from and date_to are required' };
  }
  const result = await fetchRawDownloadEventsPage(admin, scope, {
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    search: opts.search,
    offset: opts.offset,
    limit: opts.limit,
  });
  if (!result.ok) return { ok: false, error: result.error };
  const events: CampaignIntelligenceApiEventRow[] = result.rows.map((r) => ({
    event_id: r.event_id,
    title: r.title,
    raw_downloads: r.downloads,
    engaged_users: r.engaged_users,
    sent: 0,
    delivered: 0,
    opened: 0,
    not_downloaded: 0,
    open_rate: null,
    download_rate: null,
  }));
  return { ok: true, data: { events, total: result.total } };
}

/**
 * Event drilldown: users in RBAC audience for `event_id` who did not download that event's posts.
 * Phone is present only for admin scope; moderator / campaign_manager receive `null` (see RPC).
 */
export async function fetchEventUsersNotDownloadedPage(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  eventId: string,
  opts: {
    search?: string | null;
    offset: number;
    limit: number;
    dateFrom?: Date | null;
    dateTo?: Date | null;
  }
): Promise<{ ok: true; data: EventUsersNotDownloadedResponse } | { ok: false; error: string }> {
  const res = await getEventNotDownloadedUsersPage(admin, eventId, scope, opts);
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    data: {
      users: res.users,
      total: res.total,
      offset: opts.offset,
      limit: opts.limit,
    },
  };
}

type EventMeta = { id: string; name: string | null; title: string | null };

async function loadEventLabels(
  admin: SupabaseClient,
  eventIds: string[]
): Promise<Map<string, EventMeta>> {
  const out = new Map<string, EventMeta>();
  const unique = Array.from(new Set(eventIds.filter(Boolean)));
  const chunkSize = 200;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const { data, error } = await admin.from('events').select('id, name, title').in('id', chunk);
    if (error) return out;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const id = String(row.id ?? '');
      if (!id) continue;
      out.set(id, {
        id,
        name: row.name == null ? null : String(row.name),
        title: row.title == null ? null : String(row.title),
      });
    }
  }
  return out;
}

function eventDisplayTitle(m: EventMeta | undefined): string {
  if (!m) return '—';
  const t = (m.title ?? '').trim();
  const n = (m.name ?? '').trim();
  if (t) return t;
  if (n) return n;
  return '—';
}

/**
 * Event-wise download totals (scoped RPC) + minimal labels for those ids only; search + pagination in-process.
 */
export async function fetchAnalyticsEventsPage(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  opts: {
    search?: string;
    offset: number;
    limit: number;
    dateFrom?: Date | null;
    dateTo?: Date | null;
  }
): Promise<{ ok: true; data: AnalyticsEventsResponse } | { ok: false; error: string }> {
  const from = opts.dateFrom ?? new Date('2000-01-01T00:00:00.000Z');
  const to = opts.dateTo ?? new Date();
  const result = await fetchRawDownloadEventsPage(admin, scope, {
    dateFrom: from,
    dateTo: to,
    search: opts.search,
    offset: 0,
    limit: ADMIN_ANALYTICS_LIST_CAP,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const rows: AnalyticsEventPerformanceRow[] = result.rows.map((r) => ({
    event_id: r.event_id,
    download_count: r.downloads,
    title: r.title,
  }));

  const total = rows.length;
  const offset = Math.min(opts.offset, total);
  const limit = opts.limit;

  return {
    ok: true,
    data: {
      rows: rows.slice(offset, offset + limit),
      pagination: { total, offset, limit },
    },
  };
}

function filterNotDownloadedRows(
  rows: { profile_id: string; name: string | null; phone: string | null }[],
  search: string
): AnalyticsNotDownloadedRow[] {
  if (!search) return rows;
  const n = search.toLowerCase();
  return rows.filter((r) => {
    const blob = `${r.profile_id} ${r.name ?? ''} ${r.phone ?? ''}`.toLowerCase();
    return blob.includes(n);
  });
}

/**
 * Users who have not downloaded any post for the event (scoped RPC), then search + pagination.
 */
export async function fetchAnalyticsNotDownloadedPage(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  eventId: string,
  opts: {
    search?: string;
    offset: number;
    limit: number;
    dateFrom?: Date | null;
    dateTo?: Date | null;
  }
): Promise<{ ok: true; data: AnalyticsNotDownloadedResponse } | { ok: false; error: string }> {
  const res = await getEventNotDownloadedUsersPage(admin, eventId, scope, {
    search: opts.search ?? null,
    offset: opts.offset,
    limit: opts.limit,
    dateFrom: opts.dateFrom ?? null,
    dateTo: opts.dateTo ?? null,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    data: {
      rows: res.users.map((u) => ({
        profile_id: u.user_id,
        name: u.name,
        phone: u.phone,
      })),
      pagination: { total: res.total, offset: opts.offset, limit: opts.limit },
    },
  };
}

export type AnalyticsExportKind = 'kpis' | 'events' | 'not_downloaded';

/**
 * CSV for export; never includes arbitrary table dumps — only DTO fields from analytics flows.
 */
export async function buildAnalyticsExportCsv(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  kind: AnalyticsExportKind,
  opts: {
    dateFrom?: Date | null;
    dateTo?: Date | null;
    search?: string;
    eventId?: string | null;
  }
): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  const stamp = new Date().toISOString().slice(0, 10);

  if (kind === 'kpis') {
    const k = await fetchAnalyticsKpis(admin, scope, { dateFrom: opts.dateFrom, dateTo: opts.dateTo });
    if (!k.ok) return { ok: false, error: k.error };
    const lines = [
      ['period', 'total_points'].map(csvEscapeCell).join(','),
      ['all_time', String(k.data.all_time.total_points)].map(csvEscapeCell).join(','),
    ];
    if (k.data.range) {
      lines.push(
        [`range_${k.data.range.date_from}_${k.data.range.date_to}`, String(k.data.range.total_points)]
          .map(csvEscapeCell)
          .join(',')
      );
    }
    const b = k.data.time_buckets;
    lines.push(
      ['today', String(b.today)].map(csvEscapeCell).join(','),
      ['yesterday', String(b.yesterday)].map(csvEscapeCell).join(','),
      ['last_7_days', String(b.last7Days)].map(csvEscapeCell).join(','),
      ['last_30_days', String(b.last30Days)].map(csvEscapeCell).join(','),
      ['current_month', String(b.currentMonth)].map(csvEscapeCell).join(','),
      ['last_month', String(b.lastMonth)].map(csvEscapeCell).join(',')
    );
    return { ok: true, csv: lines.join('\n') + '\n', filename: `analytics-kpis-${stamp}.csv` };
  }

  if (kind === 'events') {
    const page = await fetchAnalyticsEventsPage(admin, scope, {
      search: opts.search,
      offset: 0,
      limit: ADMIN_ANALYTICS_EXPORT_MAX_ROWS,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
    });
    if (!page.ok) return { ok: false, error: page.error };
    const rows = page.data.rows.slice(0, ADMIN_ANALYTICS_EXPORT_MAX_ROWS);
    const header = ['event_id', 'title', 'download_count'].map(csvEscapeCell).join(',');
    const body = rows.map((r) => [r.event_id, r.title, String(r.download_count)].map(csvEscapeCell).join(','));
    return { ok: true, csv: [header, ...body].join('\n') + '\n', filename: `analytics-events-${stamp}.csv` };
  }

  const eid = (opts.eventId ?? '').trim();
  if (!eid) return { ok: false, error: 'event_id is required for not_downloaded export' };
  const page = await fetchAnalyticsNotDownloadedPage(admin, scope, eid, {
    search: opts.search,
    offset: 0,
    limit: ADMIN_ANALYTICS_EXPORT_MAX_ROWS,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
  });
  if (!page.ok) return { ok: false, error: page.error };
  const rows = page.data.rows.slice(0, ADMIN_ANALYTICS_EXPORT_MAX_ROWS);
  const header = ['profile_id', 'name', 'phone'].map(csvEscapeCell).join(',');
  const body = rows.map((r) => [r.profile_id, r.name ?? '', r.phone ?? ''].map(csvEscapeCell).join(','));
  return {
    ok: true,
    csv: [header, ...body].join('\n') + '\n',
    filename: `analytics-not-downloaded-${stamp}.csv`,
  };
}

export function parseAnalyticsPagination(sp: URLSearchParams): { offset: number; limit: number } {
  return {
    offset: parseOffset(sp.get('offset')),
    limit: clampLimit(sp.get('limit'), API_DEFAULT_LIMIT, API_MAX_LIMIT),
  };
}

export function parseAnalyticsDateRange(sp: URLSearchParams): { dateFrom: Date | null; dateTo: Date | null } {
  return {
    dateFrom: parseIsoDate(sp.get('date_from')),
    dateTo: parseIsoDate(sp.get('date_to')),
  };
}
