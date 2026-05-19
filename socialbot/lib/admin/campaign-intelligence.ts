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
  /** `null` only for the SQL global bucket (`event_id` IS NULL). */
  event_id: string | null;
  event_title: string;
  /** Raw `post_downloads` row count in range. */
  total_downloads: number;
  /** Distinct users with ≥1 download for the event in range. */
  engaged_users: number;
  total_notifications_sent: number;
  total_notifications_delivered: number;
  total_notifications_opened: number;
  not_downloaded_count: number;
  open_rate: number | null;
  download_rate: number | null;
};

/** Date filters for {@link getCampaignAnalytics} (all optional; passed through to RPC as timestamptz). */
export type CampaignAnalyticsFilters = {
  downloadDateFrom?: Date | null;
  downloadDateTo?: Date | null;
  notificationDateFrom?: Date | null;
  notificationDateTo?: Date | null;
};

/** Single-bucket snapshot from `admin_get_campaign_analytics` (all counts computed in SQL). */
export type CampaignAnalyticsSnapshot = {
  /** UUID string, or `null` when the global (non–event-attributed) bucket was requested. */
  event_id: string | null;
  sent: number;
  delivered: number;
  opened: number;
  downloads: number;
  not_downloaded: number;
  open_rate: number | null;
};

const EVENT_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
 * Per-event campaign metrics (fully RBAC-scoped server-side).
 *
 * **RPC:** `public.admin_campaign_intelligence_event_metrics` groups by broadcast/post **event_id**
 * (NULL bucket surfaced as **Global** with title `Global`; legacy sends keep `event_id` NULL — no backfill).
 * - **Sent:** `SUM(notification_broadcasts.target_user_count)` per `notification_broadcasts.event_id`
 * - **Delivered:** `COUNT(notifications_history)` where `delivery_status = 'sent'`, per parent broadcast `event_id`
 * - **Opened:** `COUNT(notification_open)` per parent broadcast `event_id`
 * - **Raw downloads:** `COUNT(post_downloads)`; **engaged users:** `COUNT(DISTINCT user_id)` per event (campaign events only, `dashboard_category IS NULL`)
 *
 * **RBAC:** Same predicates as {@link sqlEventsWhere} / {@link sqlProfilesWhere} in `lib/admin/rbac.ts`
 * (see migration header).
 *
 * **Rates:** `open_rate` = opened / delivered (null if delivered = 0). `download_rate` = downloads / (downloads + not_downloaded).
 */
function mapMetricRow(r: Record<string, unknown>): EventCampaignMetricRow {
  const rawEid = r.event_id;
  const event_id = rawEid === null || rawEid === undefined ? null : String(rawEid);
  return {
    event_id,
    event_title: String(r.event_title ?? '—'),
    total_downloads: Number(r.total_downloads ?? 0),
    engaged_users: Number(r.engaged_users ?? 0),
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

function mapCampaignAnalyticsSnapshot(r: Record<string, unknown>): CampaignAnalyticsSnapshot {
  const eid = r.event_id;
  return {
    event_id: eid == null || eid === '' ? null : String(eid),
    sent: Number(r.sent ?? 0),
    delivered: Number(r.delivered ?? 0),
    opened: Number(r.opened ?? 0),
    downloads: Number(r.downloads ?? 0),
    not_downloaded: Number(r.not_downloaded ?? 0),
    open_rate: r.open_rate == null || r.open_rate === '' ? null : Number(r.open_rate),
  };
}

/**
 * Reusable **server-side** campaign analytics for one `event_id` (UUID) or **global** (`eventId` null).
 *
 * Calls `public.admin_get_campaign_analytics`: sent, delivered, opened, downloads, not_downloaded, and
 * `open_rate` are all computed in the database (no client aggregation).
 */
export async function getCampaignAnalytics(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  eventId: string | null,
  filters: CampaignAnalyticsFilters = {}
): Promise<{ ok: true; data: CampaignAnalyticsSnapshot } | { ok: false; error: string }> {
  if (scopeDeniesAllRows(scope)) {
    return {
      ok: true,
      data: {
        event_id: eventId != null && String(eventId).trim() !== '' ? String(eventId).trim() : null,
        sent: 0,
        delivered: 0,
        opened: 0,
        downloads: 0,
        not_downloaded: 0,
        open_rate: null,
      },
    };
  }

  const raw = eventId != null ? String(eventId).trim() : '';
  const pEventId = raw === '' ? null : raw;
  if (pEventId != null && !EVENT_ID_UUID_RE.test(pEventId)) {
    return { ok: false, error: 'Invalid event_id: expected a UUID or empty for global' };
  }

  const rpc = campaignAnalyticsRpcScope(scope);
  const { data, error } = await admin.rpc('admin_get_campaign_analytics', {
    p_event_id: pEventId,
    p_scope_mode: rpc.p_scope_mode,
    p_moderator_state_ids: rpc.p_moderator_state_ids,
    p_cm_viewer: rpc.p_cm_viewer,
    p_cm_profile_group_ids: rpc.p_cm_profile_group_ids,
    p_cm_event_group_text: rpc.p_cm_event_group_text,
    p_download_from: toRpcTimestamptz(filters.downloadDateFrom ?? null),
    p_download_to: toRpcTimestamptz(filters.downloadDateTo ?? null),
    p_notify_from: toRpcTimestamptz(filters.notificationDateFrom ?? null),
    p_notify_to: toRpcTimestamptz(filters.notificationDateTo ?? null),
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Unexpected RPC response' };
  }

  return { ok: true, data: mapCampaignAnalyticsSnapshot(data as Record<string, unknown>) };
}
