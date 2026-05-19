import type { SupabaseClient } from '@supabase/supabase-js';

/** Default cooldown between resends to the same user for the same event (analytics drill-down). */
export const ANALYTICS_RESEND_COOLDOWN_SECONDS = 3600;

/**
 * Filters `userIds` to those allowed to receive another event notification (not in cooldown window).
 */
export async function filterUsersAllowedForEventResend(
  admin: SupabaseClient,
  eventId: string,
  userIds: string[],
  cooldownSeconds: number = ANALYTICS_RESEND_COOLDOWN_SECONDS
): Promise<{ ok: true; allowed: string[]; blocked: string[] } | { ok: false; error: string }> {
  const eid = String(eventId ?? '').trim();
  const ids = Array.from(new Set(userIds.map((x) => String(x).trim()).filter(Boolean)));
  if (!eid || ids.length === 0) {
    return { ok: true, allowed: ids, blocked: [] };
  }

  const { data, error } = await admin.rpc('admin_filter_notification_resend_allowed', {
    p_event_id: eid,
    p_user_ids: ids,
    p_cooldown_seconds: Math.max(0, Math.trunc(cooldownSeconds)),
  });
  if (error) return { ok: false, error: error.message };

  const allowed = Array.isArray(data) ? data.map((x) => String(x)) : [];
  const allowSet = new Set(allowed);
  const blocked = ids.filter((id) => !allowSet.has(id));
  return { ok: true, allowed, blocked };
}
