import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminAnalyticsScope } from '@/lib/admin/rbac';
import { scopeDeniesAllRows, sqlEventsWhere, sqlProfilesWhere } from '@/lib/admin/rbac';
import { campaignAnalyticsRpcScope } from '@/lib/admin/analyticsService';

export type CampaignIntelligenceFilters = {
  /** Inclusive lower bound on `post_downloads.created_at` (optional). */
  downloadDateFrom?: Date | null;
  /** Inclusive upper bound on `post_downloads.created_at` (optional). */
  downloadDateTo?: Date | null;
  /** Inclusive lower bound on `notification_broadcasts.created_at` (optional). */
  notificationDateFrom?: Date | null;
  /** Inclusive upper bound on `notification_broadcasts.created_at` (optional). */
  notificationDateTo?: Date | null;
  /** Case-insensitive match on `events.title` / `events.name` (optional). */
  search?: string | null;
  /** When set, only this event if it passes RBAC event scope (server-side). */
  eventId?: string | null;
  /** Server-side page size (`null` = all rows; used by admin API with clamped limit). */
  limit?: number | null;
  /** Server-side offset (non-negative). */
  offset?: number | null;
};

export type EventCampaignMetricRow = {
  event_id: string;
  event_title: string;
  total_downloads: number;
  total_notifications_sent: number;
  total_notifications_delivered: number;
  total_notifications_opened: number;
  not_downloaded_count: number;
  open_rate: number | null;
  download_rate: number | null;
};

function toRpcTimestamptz(d: Date | null | undefined): string | null {
  if (d == null) return null;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Human-readable snapshot of `sqlEventsWhere` / `sqlProfilesWhere` for the current scope
 * (for audits, tests, and drift checks against `admin_campaign_intelligence_event_metrics`).
 */
export function describeCampaignIntelligenceRbacSql(scope: AdminAnalyticsScope): {
  eventsWhere: string;
  profilesWhere: string;
} {
  return {
    eventsWhere: sqlEventsWhere(scope, 'ev'),
    profilesWhere: sqlProfilesWhere(scope, 'pr'),
  };
}

/**
 * Per-event campaign metrics (downloads, notification aggregates, reach rates), fully RBAC-scoped server-side.
 *
 * **RBAC:** `public.admin_campaign_intelligence_event_metrics` applies the same predicates as
 * {@link sqlEventsWhere} / {@link sqlProfilesWhere} in `lib/admin/rbac.ts` (see migration header).
 * This function always evaluates those helpers so scope logic cannot silently drift from the TS module.
 *
 * **Rates:** `open_rate` = opened / delivered (null if delivered = 0). `download_rate` = downloads / (downloads + not_downloaded).
 */
function mapMetricRow(r: Record<string, unknown>): EventCampaignMetricRow {
  return {
    event_id: String(r.event_id ?? ''),
    event_title: String(r.event_title ?? '—'),
    total_downloads: Number(r.total_downloads ?? 0),
    total_notifications_sent: Number(r.total_notifications_sent ?? 0),
    total_notifications_delivered: Number(r.total_notifications_delivered ?? 0),
    total_notifications_opened: Number(r.total_notifications_opened ?? 0),
    not_downloaded_count: Number(r.not_downloaded_count ?? 0),
    open_rate: r.open_rate == null || r.open_rate === '' ? null : Number(r.open_rate),
    download_rate: r.download_rate == null || r.download_rate === '' ? null : Number(r.download_rate),
  };
}

export async function getEventCampaignMetrics(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  filters: CampaignIntelligenceFilters = {}
): Promise<
  { ok: true; rows: EventCampaignMetricRow[]; total: number } | { ok: false; error: string }
> {
  if (scopeDeniesAllRows(scope)) {
    return { ok: true, rows: [], total: 0 };
  }

  const rpc = campaignAnalyticsRpcScope(scope);
  const eventId =
    filters.eventId != null && String(filters.eventId).trim() !== '' ? String(filters.eventId).trim() : null;
  const limitRaw = filters.limit;
  const limit =
    limitRaw == null || !Number.isFinite(Number(limitRaw)) ? null : Math.max(0, Math.trunc(Number(limitRaw)));
  const offsetRaw = filters.offset ?? 0;
  const offset = !Number.isFinite(Number(offsetRaw)) ? 0 : Math.max(0, Math.trunc(Number(offsetRaw)));

  const { data, error } = await admin.rpc('admin_campaign_intelligence_event_metrics', {
    p_scope_mode: rpc.p_scope_mode,
    p_moderator_state_ids: rpc.p_moderator_state_ids,
    p_cm_viewer: rpc.p_cm_viewer,
    p_cm_profile_group_ids: rpc.p_cm_profile_group_ids,
    p_cm_event_group_text: rpc.p_cm_event_group_text,
    p_download_from: toRpcTimestamptz(filters.downloadDateFrom ?? null),
    p_download_to: toRpcTimestamptz(filters.downloadDateTo ?? null),
    p_notify_from: toRpcTimestamptz(filters.notificationDateFrom ?? null),
    p_notify_to: toRpcTimestamptz(filters.notificationDateTo ?? null),
    p_search: filters.search != null && String(filters.search).trim() !== '' ? String(filters.search).trim() : null,
    p_event_id: eventId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  if (data != null && typeof data === 'object' && !Array.isArray(data) && 'rows' in data) {
    const payload = data as { total?: unknown; rows?: unknown };
    const total = Number(payload.total ?? 0);
    const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
    const rows: EventCampaignMetricRow[] = (rawRows as Record<string, unknown>[]).map((r) => mapMetricRow(r));
    return { ok: true, rows, total: Number.isFinite(total) ? total : 0 };
  }

  if (Array.isArray(data)) {
    const rows: EventCampaignMetricRow[] = (data as Record<string, unknown>[]).map((r) => mapMetricRow(r));
    return { ok: true, rows, total: rows.length };
  }

  return { ok: true, rows: [], total: 0 };
}
