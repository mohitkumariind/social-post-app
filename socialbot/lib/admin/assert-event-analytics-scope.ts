import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminAnalyticsScope } from '@/lib/admin/rbac';

/**
 * Minimal `events` row fields for analytics RBAC (aligned with `sqlEventsWhere` in `lib/admin/rbac.ts`).
 */
export type EventRowForAnalyticsScope = {
  state_id?: unknown;
  target_groups?: unknown;
  created_by?: string | null;
};

function asFiniteNumberArray(v: unknown): number[] {
  if (v == null) return [];
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

function asNonEmptyStringArray(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

/**
 * Pure check: whether an `events` row is visible under {@link AdminAnalyticsScope}
 * (admin all, moderator state-only, campaign manager group + own-created).
 */
export function eventRowReadableInAdminAnalyticsScope(
  scope: AdminAnalyticsScope,
  row: EventRowForAnalyticsScope
): boolean {
  if (scope.kind === 'unrestricted') return true;
  if (scope.kind === 'moderator') {
    if (scope.malformed || scope.stateIds.length === 0) return false;
    const evStates = asFiniteNumberArray(row.state_id);
    if (evStates.length === 0) return false;
    const allow = new Set(scope.stateIds.map((n) => Number(n)));
    return evStates.every((id) => allow.has(id));
  }
  const vid = String(scope.viewerId ?? '').trim();
  if (scope.malformed || !vid || scope.groupIdsText.length === 0) return false;
  if (row.created_by != null && String(row.created_by).trim() === vid) return true;
  const tg = asNonEmptyStringArray(row.target_groups);
  if (tg.length === 0) return false;
  const allow = new Set(scope.groupIdsText.map((g) => String(g)));
  return tg.some((g) => allow.has(String(g)));
}

/**
 * Loads the event by id and verifies it is within analytics scope **before** running scoped RPCs.
 * Prevents cross-state / cross-group / cross-CM UUID probing (fail-closed with 403).
 */
export async function assertEventReadableForAdminAnalytics(
  admin: SupabaseClient,
  scope: AdminAnalyticsScope,
  eventId: string
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  if (scope.kind === 'unrestricted') return { ok: true };
  const { data, error } = await admin
    .from('events')
    .select('id, state_id, target_groups, created_by')
    .eq('id', eventId)
    .maybeSingle();
  if (error) return { ok: false, status: 403, error: error.message };
  if (!data) return { ok: false, status: 404, error: 'Event not found' };
  if (!eventRowReadableInAdminAnalyticsScope(scope, data as EventRowForAnalyticsScope)) {
    return { ok: false, status: 403, error: 'Forbidden: event outside your scope' };
  }
  return { ok: true };
}
