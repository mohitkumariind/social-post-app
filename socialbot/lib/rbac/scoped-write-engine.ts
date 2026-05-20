import { logAdminAction } from '@/lib/audit/logAdminAction';
import { canAccessResource, resolveScope, type UnifiedResource, type UnifiedUser } from '@/lib/rbac/unified-scope-engine';
import { evaluateAnomaliesForUser, trackRbacEvent } from '@/lib/rbac/rbac-observability-engine';
import { emitRbacAlerts } from '@/lib/rbac/rbac-alert-engine';
import { normalizeGroupId, parseGroupIds, parseStateIds } from '@/lib/rbac/require';
import {
  auditUnsupportedResourceUsage,
  canUseOwnershipFallback,
  validateRegisteredResourceForLayer,
} from '@/lib/rbac/resource-classification';
import { isActiveEventDashboardCategory } from '@/lib/dashboard-event-category';

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
  | 'templates.delete'
  | 'twitter_campaigns.create'
  | 'twitter_campaigns.update'
  | 'twitter_campaigns.delete'
  | 'twitter_campaigns.publish'
  | 'twitter_campaigns.pause'
  | 'twitter_campaigns.resume'
  | 'twitter_campaigns.cancel_waves'
  | 'twitter_campaigns.retry_notifications';

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
  const resourceType = String(audit?.resourceType ?? '').trim();
  const resourceValidation = validateRegisteredResourceForLayer(resourceType, 'mutation');
  if (!resourceValidation.ok) {
    auditUnsupportedResourceUsage({
      user,
      resourceType,
      layer: 'mutation',
      reason: resourceValidation.reason,
      action,
      resourceId: audit?.resourceId ?? null,
      resourceName: audit?.resourceName ?? null,
      details: { mutation_action: action },
    });
    const denied = { ok: false as const, reason: resourceValidation.reason };
    if (audit) {
      auditDenied({
        user,
        action,
        resourceType: audit.resourceType,
        resourceId: audit.resourceId,
        resourceName: audit.resourceName,
        reason: denied.reason,
      });
    }
    return denied;
  }

  if (user.role === 'admin' || user.role === 'super_admin') return { ok: true };

  const mutationResourceOwner = (resource as { created_by?: unknown } | null)?.created_by;

  if (
    (action === 'posts.create' || action === 'posts.update') &&
    resourceType === 'posts' &&
    (user.role === 'moderator' || user.role === 'campaign_manager')
  ) {
    const owner = mutationResourceOwner != null ? String(mutationResourceOwner).trim() : '';
    if (owner && owner === String(user.id).trim()) {
      return { ok: true };
    }
  }

  if (user.role === 'editor') {
    if (action === 'events.create' || action === 'events.update' || action === 'posts.create' || action === 'posts.update') {
      return { ok: true };
    }
    const denied = { ok: false as const, reason: 'Forbidden: editor may only manage own events and posts' };
    if (audit) {
      auditDenied({
        user,
        action,
        resourceType: audit.resourceType,
        resourceId: audit.resourceId,
        resourceName: audit.resourceName,
        reason: denied.reason,
      });
    }
    return denied;
  }

  if (
    action === 'events.create' &&
    isActiveEventDashboardCategory((payload as any)?.dashboard_category) &&
    (user.role === 'moderator' || user.role === 'campaign_manager')
  ) {
    return { ok: true };
  }

  const payloadFilters = ((payload as any)?.filters ?? null) as Record<string, unknown> | null;
  // Build effective resource scope from resource+payload (payload for creates).
  const effective: UnifiedResource = {
    created_by: (resource as any)?.created_by ?? (payload as any)?.created_by,
    state_ids:
      (resource as any)?.state_ids ??
      (payload as any)?.state_id ??
      (payload as any)?.assigned_state_ids ??
      (payloadFilters as any)?.assigned_state_ids,
    group_id: (resource as any)?.group_id ?? (payload as any)?.group_id,
    group_ids:
      (resource as any)?.group_ids ??
      (payload as any)?.target_groups ??
      (payload as any)?.group_ids ??
      (payloadFilters as any)?.group_ids,
  };

  const allowOwnershipFallback = canUseOwnershipFallback(resourceType);

  // Moderator rules: state-scoped first; owner fallback only for approved resource types.
  if (user.role === 'moderator') {
    const rStatesParsed = parseStateIds(effective.state_ids);
    const assignedParsed = parseStateIds(user.assigned_state_ids);
    if (rStatesParsed.malformed || assignedParsed.malformed) {
      const denied = { ok: false as const, reason: 'Forbidden: malformed state scope', details: { state_ids: effective.state_ids, assigned_state_ids: user.assigned_state_ids } };
      if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason, details: denied.details });
      return denied;
    }
    const rStates = rStatesParsed.ids;
    const assigned = assignedParsed.ids;
    if (action === 'events.update' && isActiveEventDashboardCategory((payload as any)?.dashboard_category)) {
      return { ok: true };
    }
    if (rStates.length > 0) {
      // Conservative: require subset to avoid weakening existing restrictions.
      const set = new Set(assigned);
      const ok = rStates.every((n) => set.has(n));
      if (ok) return { ok: true };
      const denied = { ok: false as const, reason: 'Forbidden: outside assigned_state_ids', details: { rStates, assigned } };
      if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason, details: denied.details });
      return denied;
    }
    if (allowOwnershipFallback && canAccessResource(user, { created_by: effective.created_by }, { resourceType, allowOwnershipFallback: true })) {
      return { ok: true };
    }
    const denied = { ok: false as const, reason: 'Forbidden: missing state scope', details: { state_ids: effective.state_ids } };
    if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason, details: denied.details });
    return denied;
  }

  // Campaign manager rules: group-scoped first; owner fallback only for approved resource types.
  if (user.role === 'campaign_manager') {
    if (action === 'events.update' && isActiveEventDashboardCategory((payload as any)?.dashboard_category)) {
      return { ok: true };
    }
    const gid = normalizeGroupId(effective.group_id) ?? '';
    const gidsParsed = parseGroupIds(effective.group_ids);
    const assignedParsed = parseGroupIds(user.assigned_group_ids);
    if (gidsParsed.malformed || assignedParsed.malformed || (effective.group_id != null && !gid)) {
      const denied = {
        ok: false as const,
        reason: 'Forbidden: malformed group scope',
        details: { group_id: effective.group_id, group_ids: effective.group_ids, assigned_group_ids: user.assigned_group_ids },
      };
      if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason, details: denied.details });
      return denied;
    }
    const gids = gidsParsed.ids;
    const assigned = assignedParsed.ids;
    if (gid || gids.length > 0) {
      const ok = canAccessResource(user, { group_id: gid || undefined, group_ids: gids.length > 0 ? gids : undefined }, { resourceType });
      if (ok) return { ok: true };
      const denied = { ok: false as const, reason: 'Forbidden: outside assigned_group_ids', details: { gid, gids, assigned } };
      if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason, details: denied.details });
      return denied;
    }
    if (allowOwnershipFallback && canAccessResource(user, { created_by: effective.created_by }, { resourceType, allowOwnershipFallback: true })) {
      return { ok: true };
    }
    const denied = { ok: false as const, reason: 'Forbidden: missing group scope', details: { group_id: effective.group_id, group_ids: effective.group_ids } };
    if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason, details: denied.details });
    return denied;
  }

  const denied = { ok: false as const, reason: 'Forbidden' };
  if (audit) auditDenied({ user, action, resourceType: audit.resourceType, resourceId: audit.resourceId, resourceName: audit.resourceName, reason: denied.reason });
  return denied;
}

