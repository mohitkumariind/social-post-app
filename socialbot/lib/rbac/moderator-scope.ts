import type { VerifiedAdminAuth } from '@/lib/admin-gate';
import { toRbacActor } from '@/lib/admin-gate';
import { isActiveEventDashboardCategory } from '@/lib/dashboard-event-category';
import { canAccessScope, normalizeResourceScope } from '@/lib/rbac';
import { requireScopeState, toNumArray } from '@/lib/rbac/require';

const MODERATOR_EVENT_FORBIDDEN_KEYS = [
  'target_groups',
  'profile_ids',
  'group_id',
  'loksabha_id',
  'loksabha',
  'assembly_id',
  'assembly',
] as const;

function scopeFieldPopulated(payload: Record<string, unknown>, key: string): boolean {
  const v = payload[key];
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim().length > 0;
}

/**
 * Moderator event create/update: state + optional party within assignment only.
 * No global dashboard events, groups, or constituency fields.
 */
export function validateModeratorEventPayload(
  auth: VerifiedAdminAuth,
  payload: Record<string, unknown>
): string | null {
  for (const k of MODERATOR_EVENT_FORBIDDEN_KEYS) {
    if (scopeFieldPopulated(payload, k)) {
      return `Forbidden: moderator cannot target ${k}`;
    }
  }

  if (isActiveEventDashboardCategory(payload.dashboard_category)) {
    return 'Forbidden: moderator cannot create global dashboard events';
  }

  const stateIds = toNumArray(payload.state_id);
  if (stateIds.length === 0) {
    return 'Forbidden: moderator event must target at least one state';
  }

  try {
    requireScopeState(stateIds, auth.assigned_state_ids, 'subset');
  } catch {
    return 'Forbidden: event includes states outside assignment';
  }

  const access = canAccessScope(toRbacActor(auth), normalizeResourceScope(payload));
  if (!access.allowed) {
    return access.denied_reason ?? 'Forbidden: outside moderator scope';
  }
  return null;
}
