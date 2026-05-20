import {
  remergeLockedEventCampaignAttribution,
  snapshotEventCampaignEventIdForAttribution,
  type BroadcastFilters,
  type BroadcastPayload,
} from '@/lib/broadcast-send';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';
import type { SupabaseClient } from '@supabase/supabase-js';
import { canAccessResource, type UnifiedUser } from '@/lib/rbac/unified-scope-engine';
import { parseGroupIds, RbacError } from '@/lib/rbac/require';
import {
  buildScopedAnalyticsQuery,
  resolveAllowedProfileIdsForCampaignManager,
  resolveEffectiveGroupIdsForCampaignManager,
} from '@/lib/rbac/scoped-query-builder';

export type NotificationAuth = Pick<
  VerifiedAdminAuth,
  'user' | 'role' | 'assigned_state_ids' | 'assigned_group_ids'
>;

function toGroupIdNums(groupIds: string[]): number[] {
  return groupIds.map((x) => Number(x)).filter((n) => Number.isSafeInteger(n) && n > 0);
}

/**
 * Canonical notification target shaping for send/schedule flows.
 * Ensures moderator/campaign_manager payload scope is normalized and fail-closed.
 *
 * Event campaign `event_id` / `data.type` are snapshotted and re-merged after filter changes so
 * audience selection never drops event linkage.
 */
export function applyCanonicalNotificationTargeting(
  auth: NotificationAuth,
  payload: BroadcastPayload,
  auditAction: 'notifications.scope.validate' | 'notifications.schedule.scope.validate'
): BroadcastPayload {
  const lockedEventCampaignId = snapshotEventCampaignEventIdForAttribution(payload);

  if (auth.role === 'admin') {
    return remergeLockedEventCampaignAttribution(payload, lockedEventCampaignId);
  }

  if (auth.role === 'moderator') {
    return remergeLockedEventCampaignAttribution(
      {
        ...payload,
        all_workers: false,
        filters: {
          ...(payload.filters ?? {}),
          assigned_state_ids: auth.assigned_state_ids,
        } as BroadcastFilters,
      },
      lockedEventCampaignId
    );
  }

  // campaign_manager: groups-only targeting with canonical numeric group ids.
  const parsedGroupIds = parseGroupIds(auth.assigned_group_ids);
  if (parsedGroupIds.malformed) throw new RbacError('Forbidden: malformed assigned_group_ids', 403);
  const groupIds = toGroupIdNums(parsedGroupIds.ids);
  if (groupIds.length === 0) throw new RbacError('Forbidden: no assigned groups to target', 403);
  const ok = canAccessResource(
    { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids },
    { group_ids: groupIds.map(String) },
    { resourceType: 'notifications', audit: { resourceType: 'notifications', action: auditAction } }
  );
  if (!ok) throw new RbacError('Forbidden', 403);

  return remergeLockedEventCampaignAttribution(
    {
      ...payload,
      all_workers: false,
      filters: {
        ...(payload.filters ?? {}),
        group_ids: groupIds,
      } as BroadcastFilters,
    },
    lockedEventCampaignId
  );
}

const MAX_EXPLICIT_NOTIFICATION_RECIPIENTS = 5000;

/**
 * Intersects candidate profile ids with profiles visible to the admin actor (analytics-aligned scoping).
 */
export async function filterRecipientProfileIdsForAdmin(
  admin: SupabaseClient,
  auth: NotificationAuth,
  candidateIds: string[]
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  const unique = [...new Set(candidateIds.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: 'No recipient user ids' };
  if (unique.length > MAX_EXPLICIT_NOTIFICATION_RECIPIENTS) {
    return { ok: false, error: `Too many recipients (max ${MAX_EXPLICIT_NOTIFICATION_RECIPIENTS})` };
  }

  if (auth.role === 'admin') {
    const { data, error } = await admin.from('profiles').select('id').in('id', unique);
    if (error) return { ok: false, error: error.message };
    const ids = (data ?? []).map((r: { id: string }) => String(r.id)).filter(Boolean);
    return { ok: true, ids };
  }

  const user: UnifiedUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids ?? [],
  };

  let ctx: { effective_group_ids?: string[]; allowed_profile_ids?: string[] } = {};
  if (auth.role === 'campaign_manager') {
    const eff = await resolveEffectiveGroupIdsForCampaignManager(admin, auth.user.id, auth.assigned_group_ids ?? []);
    if (eff === null) return { ok: false, error: 'Unable to resolve group assignments' };
    const allowed = await resolveAllowedProfileIdsForCampaignManager(admin, auth.assigned_group_ids ?? []);
    ctx = { effective_group_ids: eff, allowed_profile_ids: allowed ?? undefined };
  }

  const chunk = 200;
  const out = new Set<string>();
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    let q = admin.from('profiles').select('id').in('id', slice);
    q = buildScopedAnalyticsQuery(user, q as never, 'profiles', ctx) as typeof q;
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    for (const r of data ?? []) {
      const id = String((r as { id?: string }).id ?? '').trim();
      if (id) out.add(id);
    }
  }
  return { ok: true, ids: Array.from(out) };
}
