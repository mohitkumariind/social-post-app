import { logAdminAction } from '@/lib/audit/logAdminAction';
import { canAccessResource, resolveScope, type UnifiedResource, type UnifiedUser } from '@/lib/rbac/unified-scope-engine';
import { evaluateAnomaliesForUser, trackRbacEvent } from '@/lib/rbac/rbac-observability-engine';
import { emitRbacAlerts } from '@/lib/rbac/rbac-alert-engine';
import { toNumArray, toStrArray } from '@/lib/rbac/require';

export type MutationAction =
  | 'events.create'
  | 'events.update'
  | 'events.delete'
  | 'events.publish'
  | 'events.archive'
  | 'events.schedule'
  | 'posts.create'
  | 'posts.update'
  | 'posts.delete'
  | 'profiles.delete'
  | 'profiles.bulk_tags'
  | 'groups.create'
  | 'groups.update'
  | 'groups.delete'
  | 'groups.members.add'
  | 'groups.members.remove'
  | 'notifications.send'
  | 'notifications.schedule'
  | 'templates.create'
  | 'templates.update'
  | 'templates.delete';

export type MutationDecision =
  | { ok: true }
  | { ok: false; reason: string; details?: Record<string, unknown> };

function auditDenied(args: {
  user: UnifiedUser;
  action: MutationAction;
  resourceType: string;
  resourceId?: string | null;
  resourceName?: string | null;
  reason: string;
  details?: Record<string, unknown>;
}) {
  const scope = resolveScope(args.user);
  void trackRbacEvent({
    user_id: args.user.id,
    role: args.user.role,
    event_type: 'mutation',
    action: args.action,
    resource_type: args.resourceType,
    resource_id: args.resourceId ?? null,
    result: 'denied',
    scope_state_ids: scope.type === 'STATE' ? scope.states : [],
    scope_group_ids: scope.type === 'GROUP' ? scope.groups : [],
    severity: 'warning',
    metadata: { denied: true, reason: args.reason, ...(args.details ?? {}) },
  });
  void (async () => {
    const signals = await evaluateAnomaliesForUser({ user_id: args.user.id, role: args.user.role });
    if (signals.length > 0) {
      for (const s of signals) {
        void trackRbacEvent({
          user_id: args.user.id,
          role: args.user.role,
          event_type: s.event_type,
          action: s.action,
          resource_type: args.resourceType,
          resource_id: args.resourceId ?? null,
          result: 'denied',
          severity: s.severity,
          scope_state_ids: scope.type === 'STATE' ? scope.states : [],
          scope_group_ids: scope.type === 'GROUP' ? scope.groups : [],
          metadata: s.metadata,
        });
      }
      await emitRbacAlerts({ user_id: args.user.id, role: args.user.role, signals });
    }
  })();
  void logAdminAction({
    actor_user_id: args.user.id,
    actor_role: args.user.role,
    action_type: `${args.action}.denied`,
    resource_type: args.resourceType,
    resource_id: args.resourceId ?? null,
    resource_name: args.resourceName ?? null,
    severity: 'warning',
    undoable: false,
    metadata: { denied: true, reason: args.reason, ...(args.details ?? {}) },
    scope_state_ids: scope.type === 'STATE' ? scope.states : [],
    scope_group_ids: scope.type === 'GROUP' ? scope.groups : [],
  });
}

/**
 * Central mutation RBAC guard.
 * - Does NOT modify Unified Scope Engine logic; it only uses it consistently.
 * - Must be called BEFORE any DB write.
 */
export function canPerformMutation(
  user: UnifiedUser,
  action: MutationAction,
  resource: UnifiedResource | null = null,
  payload: Record<string, unknown> | null = null,
  audit?: { resourceType: string; resourceId?: string | null; resourceName?: string | null }
): MutationDecision {
  if (user.role === 'admin') return { ok: true };

  // Build effective resource scope from resource+payload (payload for creates).
  const effective: UnifiedResource = {
    created_by: (resource as any)?.created_by ?? (payload as any)?.created_by,
    state_ids: (resource as any)?.state_ids ?? (payload as any)?.state_id ?? (payload as any)?.assigned_state_ids,
    group_id: (resource as any)?.group_id ?? (payload as any)?.group_id,
    group_ids: (resource as any)?.group_ids ?? (payload as any)?.target_groups ?? (payload as any)?.group_ids,
  };

  // Moderator rules: state-scoped or ownership fallback.
  if (user.role === 'moderator') {
    const rStates = toNumArray(effective.state_ids);
    const assigned = toNumArray(user.assigned_state_ids);
    if (rStates.length > 0) {
      // Conservative: require subset to avoid weakening existing restrictions.
      const set = new Set(assigned.map(Number));
      const ok = rStates.every((n) => set.has(Number(n)));
      if (ok) return { ok: true };
      const denied = { ok: false as const, reason: 'Forbidden: outside assigned_state_ids', details: { rStates, assigned } };
      if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason, details: denied.details });
      return denied;
    }
    // Ownership fallback when no scope fields exist.
    if (canAccessResource(user, { created_by: effective.created_by })) return { ok: true };
    const denied = { ok: false as const, reason: 'Forbidden: not owner', details: { created_by: effective.created_by } };
    if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason, details: denied.details });
    return denied;
  }

  // Campaign manager rules: group-scoped or ownership fallback.
  if (user.role === 'campaign_manager') {
    const gid = String(effective.group_id ?? '').trim();
    const gids = toStrArray(effective.group_ids);
    const assigned = toStrArray(user.assigned_group_ids);
    if (gid || gids.length > 0) {
      const ok = canAccessResource(user, { group_id: gid || undefined, group_ids: gids.length > 0 ? gids : undefined });
      if (ok) return { ok: true };
      const denied = { ok: false as const, reason: 'Forbidden: outside assigned_group_ids', details: { gid, gids, assigned } };
      if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason, details: denied.details });
      return denied;
    }
    if (canAccessResource(user, { created_by: effective.created_by })) return { ok: true };
    const denied = { ok: false as const, reason: 'Forbidden: not owner', details: { created_by: effective.created_by } };
    if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason, details: denied.details });
    return denied;
  }

  const denied = { ok: false as const, reason: 'Forbidden' };
  if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason });
  return denied;
}

