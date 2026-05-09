import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { parseGroupIds, RbacError } from '@/lib/rbac/require';
import type { BroadcastPayload } from '@/lib/broadcast-send';

type NotificationAuth = {
  user: { id: string };
  role: 'admin' | 'moderator' | 'campaign_manager';
  assigned_state_ids: number[];
  assigned_group_ids?: string[];
};

function toGroupIdNums(groupIds: string[]): number[] {
  return groupIds.map((x) => Number(x)).filter((n) => Number.isSafeInteger(n) && n > 0);
}

/**
 * Canonical notification target shaping for send/schedule flows.
 * Ensures moderator/campaign_manager payload scope is normalized and fail-closed.
 */
export function applyCanonicalNotificationTargeting(
  auth: NotificationAuth,
  payload: BroadcastPayload,
  auditAction: 'notifications.scope.validate' | 'notifications.schedule.scope.validate'
): BroadcastPayload {
  if (auth.role === 'admin') return payload;

  if (auth.role === 'moderator') {
    return {
      ...payload,
      all_workers: false,
      filters: {
        ...(payload.filters ?? {}),
        assigned_state_ids: auth.assigned_state_ids,
      } as any,
    };
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

  return {
    ...payload,
    all_workers: false,
    filters: {
      ...(payload.filters ?? {}),
      group_ids: groupIds,
    } as any,
  };
}
