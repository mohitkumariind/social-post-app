import {
  normalizeActorId,
  normalizeGroupId,
  parseGroupIds,
  parseStateIds,
  type RbacRole,
} from '@/lib/rbac/require';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { trackRbacEvent } from '@/lib/rbac/rbac-observability-engine';
import {
  auditUnsupportedResourceUsage,
  canUseOwnershipFallback,
  validateRegisteredResourceForLayer,
} from '@/lib/rbac/resource-classification';
import { isActiveEventDashboardCategory } from '@/lib/dashboard-event-category';

export type UnifiedScope =
  | { type: 'GLOBAL' }
  | { type: 'STATE'; states: number[] }
  | { type: 'GROUP'; groups: string[] };

export type UnifiedUser = {
  id: string;
  role: RbacRole;
  assigned_state_ids: number[];
  assigned_group_ids?: string[];
};

export type UnifiedResource = {
  created_by?: unknown;
  state_ids?: unknown;
  group_id?: unknown;
  group_ids?: unknown;
  /** When set on `events`, global dashboard category rows may omit geo/group scope. */
  dashboard_category?: unknown;
};

type AccessAuditContext = {
  resourceType: string;
  action?: string;
  resourceId?: string | null;
  resourceName?: string | null;
};

type AccessOptions = {
  resourceType?: string;
  allowOwnershipFallback?: boolean;
  audit?: AccessAuditContext;
};

export function resolveScope(user: Pick<UnifiedUser, 'role' | 'assigned_state_ids' | 'assigned_group_ids'>): UnifiedScope {
  if (user.role === 'admin') return { type: 'GLOBAL' };
  if (user.role === 'moderator') return { type: 'STATE', states: parseStateIds(user.assigned_state_ids).ids };
  return { type: 'GROUP', groups: parseGroupIds(user.assigned_group_ids).ids };
}

function stateScopeAllows(scope: Extract<UnifiedScope, { type: 'STATE' }>, resource: UnifiedResource): boolean {
  const assignedParsed = parseStateIds(scope.states);
  const resourceParsed = parseStateIds(resource.state_ids);
  if (assignedParsed.malformed || resourceParsed.malformed) return false;
  const assigned = new Set(assignedParsed.ids);
  if (assigned.size === 0) return false;
  const rStates = resourceParsed.ids;
  if (rStates.length === 0) return false;
  return rStates.every((n) => assigned.has(n));
}

function groupScopeAllows(scope: Extract<UnifiedScope, { type: 'GROUP' }>, resource: UnifiedResource): boolean {
  const assignedParsed = parseGroupIds(scope.groups);
  const gidsParsed = parseGroupIds(resource.group_ids);
  if (assignedParsed.malformed || gidsParsed.malformed) return false;
  const assigned = new Set(assignedParsed.ids);
  if (assigned.size === 0) return false;

  const gid = normalizeGroupId(resource.group_id) ?? '';
  const gids = gidsParsed.ids;

  if (gid) return assigned.has(gid);
  if (gids.length > 0) return gids.every((g) => assigned.has(g));
  return false;
}

function isOwner(userId: string, createdBy: unknown): boolean {
  const owner = normalizeActorId(createdBy);
  return !!owner && owner === normalizeActorId(userId);
}

function auditAccessDenied(user: UnifiedUser, ctx: AccessAuditContext | undefined, reason: string, details?: Record<string, unknown>) {
  if (!ctx) return;
  const scope = resolveScope(user);
  void trackRbacEvent({
    user_id: user.id,
    role: user.role,
    event_type: 'read',
    action: ctx.action ?? 'resource.access',
    resource_type: ctx.resourceType,
    resource_id: ctx.resourceId ?? null,
    result: 'denied',
    scope_state_ids: scope.type === 'STATE' ? scope.states : [],
    scope_group_ids: scope.type === 'GROUP' ? scope.groups : [],
    severity: 'warning',
    metadata: { denied: true, reason, ...(details ?? {}) },
  });
  void logAdminAction({
    actor_user_id: user.id,
    actor_role: user.role,
    action_type: `${ctx.action ?? 'resource.access'}.denied`,
    resource_type: ctx.resourceType,
    resource_id: ctx.resourceId ?? null,
    resource_name: ctx.resourceName ?? null,
    severity: 'warning',
    undoable: false,
    metadata: { denied: true, reason, ...(details ?? {}) },
    scope_state_ids: scope.type === 'STATE' ? scope.states : [],
    scope_group_ids: scope.type === 'GROUP' ? scope.groups : [],
  });
}

/**
 * Central RBAC decision.
 *
 * Canonical enterprise rules:
 * - Admin: always true
 * - Moderator: requires resource.state_ids subset of assigned_state_ids
 * - Campaign manager: requires resource.group_id or group_ids subset of assigned_group_ids
 * - Missing scope defaults to deny for scope-protected resources (fail-closed)
 * - Ownership fallback is allowed only for explicitly classified owner-only/legacy resources
 * - Default: false
 */
export function canAccessResource(user: UnifiedUser, resource: UnifiedResource, options: AccessOptions = {}): boolean {
  const resourceType = String(options.resourceType ?? '').trim();
  const resourceValidation = validateRegisteredResourceForLayer(resourceType, 'access');
  if (!resourceValidation.ok) {
    auditUnsupportedResourceUsage({
      user,
      resourceType,
      layer: 'access',
      reason: resourceValidation.reason,
      action: options.audit?.action ?? 'rbac.access.resource_validation',
      resourceId: options.audit?.resourceId ?? null,
      resourceName: options.audit?.resourceName ?? null,
    });
    return false;
  }

  if (user.role === 'admin') return true;

  const allowOwnershipFallback = options.allowOwnershipFallback ?? canUseOwnershipFallback(resourceType);
  const scope = resolveScope(user);
  if (scope.type === 'STATE') {
    const rStatesParsed = parseStateIds(resource.state_ids);
    if (rStatesParsed.malformed) {
      auditAccessDenied(user, options.audit, 'Forbidden: malformed state scope', { state_ids: resource.state_ids, resourceType });
      return false;
    }
    const rStates = rStatesParsed.ids;
    if (rStates.length === 0) {
      if (
        resourceType === 'events' &&
        isActiveEventDashboardCategory(resource.dashboard_category) &&
        isOwner(user.id, resource.created_by)
      ) {
        return true;
      }
      if (allowOwnershipFallback && isOwner(user.id, resource.created_by)) return true;
      auditAccessDenied(user, options.audit, 'Forbidden: missing state scope', { state_ids: resource.state_ids, allowOwnershipFallback, resourceType });
      return false;
    }
    const ok = stateScopeAllows(scope, resource);
    if (!ok) {
      auditAccessDenied(user, options.audit, 'Forbidden: outside assigned_state_ids', { state_ids: rStates, assigned_state_ids: scope.states, resourceType });
    }
    return ok;
  }
  if (scope.type === 'GROUP') {
    const gid = normalizeGroupId(resource.group_id) ?? '';
    const gidsParsed = parseGroupIds(resource.group_ids);
    if (gidsParsed.malformed) {
      auditAccessDenied(user, options.audit, 'Forbidden: malformed group scope', { group_id: resource.group_id, group_ids: resource.group_ids, resourceType });
      return false;
    }
    const gids = gidsParsed.ids;
    if (!gid && gids.length === 0) {
      if (
        resourceType === 'events' &&
        isActiveEventDashboardCategory(resource.dashboard_category) &&
        isOwner(user.id, resource.created_by)
      ) {
        return true;
      }
      if (allowOwnershipFallback && isOwner(user.id, resource.created_by)) return true;
      auditAccessDenied(user, options.audit, 'Forbidden: missing group scope', { group_id: resource.group_id, group_ids: resource.group_ids, allowOwnershipFallback, resourceType });
      return false;
    }
    const ok = groupScopeAllows(scope, resource);
    if (!ok) {
      auditAccessDenied(user, options.audit, 'Forbidden: outside assigned_group_ids', { group_id: gid, group_ids: gids, assigned_group_ids: scope.groups, resourceType });
    }
    return ok;
  }
  return false;
}

