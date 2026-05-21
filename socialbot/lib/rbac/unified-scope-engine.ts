import { canAccessScope, type RbacActor } from '@/lib/rbac/permission-engine';
import { isAdminRole } from '@/lib/rbac/dashboard-permissions';
import { normalizeResourceScope } from '@/lib/rbac/normalize-scope';
import { normalizeActorId, parseGroupIds, parseStateIds, type RbacRole } from '@/lib/rbac/require';
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
  assigned_party_ids?: string[];
  assigned_loksabha_ids?: number[];
  assigned_assembly_ids?: number[];
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

function toActor(user: UnifiedUser): RbacActor {
  return {
    id: user.id,
    role: user.role,
    assigned_state_ids: user.assigned_state_ids,
    assigned_group_ids: user.assigned_group_ids ?? [],
    assigned_party_ids: user.assigned_party_ids ?? [],
    assigned_loksabha_ids: user.assigned_loksabha_ids,
    assigned_assembly_ids: user.assigned_assembly_ids,
  };
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

  if (isAdminRole(user.role)) return true;

  const actor = toActor(user);

  if (resourceType === 'events' || resourceType === 'posts') {
    const resourceScope = normalizeResourceScope({
      state_ids: resource.state_ids,
      state_id: resource.state_ids,
      group_ids: resource.group_ids,
      group_id: resource.group_id,
      target_groups: resource.group_ids,
      created_by: resource.created_by,
    });
    if (resourceScope.state_ids.length === 0 && resourceScope.group_ids.length === 0) {
      auditAccessDenied(user, options.audit, 'Forbidden: missing event scope', { resourceType });
      return false;
    }
    const decision = canAccessScope(actor, resourceScope);
    if (!decision.allowed) {
      auditAccessDenied(user, options.audit, decision.denied_reason ?? 'Forbidden: outside scope', {
        resourceType,
        normalized_scope: decision.debug.normalized_scope,
      });
    }
    return decision.allowed;
  }

  const allowOwnershipFallback = options.allowOwnershipFallback ?? canUseOwnershipFallback(resourceType);
  const resourceScope = normalizeResourceScope({
    state_ids: resource.state_ids,
    state_id: resource.state_ids,
    group_ids: resource.group_ids,
    group_id: resource.group_id,
    target_groups: resource.group_ids,
    dashboard_category: resource.dashboard_category,
  });

  if (resourceScope.state_ids.length === 0 && resourceScope.group_ids.length === 0) {
    if (
      resourceType === 'events' &&
      isActiveEventDashboardCategory(resource.dashboard_category) &&
      isOwner(user.id, resource.created_by)
    ) {
      return true;
    }
    if (allowOwnershipFallback && isOwner(user.id, resource.created_by)) return true;
    auditAccessDenied(user, options.audit, 'Forbidden: missing resource scope', { resourceType });
    return false;
  }

  const decision = canAccessScope(actor, resourceScope);
  if (decision.allowed) return true;

  if (allowOwnershipFallback && isOwner(user.id, resource.created_by)) return true;

  auditAccessDenied(user, options.audit, decision.denied_reason ?? 'Forbidden: outside scope', {
    resourceType,
    normalized_scope: decision.debug.normalized_scope,
  });
  return false;
}

