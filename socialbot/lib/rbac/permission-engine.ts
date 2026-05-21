import { eventVisibilityMatch, isEventVisibleToActor, partyOverlap } from '@/lib/rbac/event-visibility-engine';
import {
  isGlobalTargeting,
  isPublishedEvent,
  normalizeEventResource,
  normalizeResourceScope,
} from '@/lib/rbac/normalize-scope';
import { logRbacDebug } from '@/lib/rbac/debug';
import { logPermissionDecisionFromDebug } from '@/lib/rbac/permission-audit';
import { getCachedNormalizedScope } from '@/lib/rbac/scope-cache';
import { normalizeActorId } from '@/lib/rbac/require';
import type {
  CanonicalScope,
  NormalizedEventResource,
  PermissionDecision,
  RbacActor,
  RbacDebugPayload,
} from '@/lib/rbac/scope-types';
import { PANEL_EVENT_CREATOR_ROLES } from '@/lib/rbac/scope-types';

export type { CanonicalScope, NormalizedEventResource, PermissionDecision, RbacActor, RbacDebugPayload };

export { normalizeScope } from '@/lib/rbac/normalize-scope';
export { getCachedNormalizedScope } from '@/lib/rbac/scope-cache';

function actorScope(
  actor: Pick<
    RbacActor,
    | 'role'
    | 'assigned_state_ids'
    | 'assigned_group_ids'
    | 'assigned_party_ids'
    | 'assigned_loksabha_ids'
    | 'assigned_assembly_ids'
    | 'effective_group_ids'
  > & { id?: string }
) {
  return getCachedNormalizedScope({
    id: actor.id ?? '',
    role: actor.role,
    assigned_state_ids: actor.assigned_state_ids,
    assigned_group_ids: actor.assigned_group_ids,
    assigned_party_ids: actor.assigned_party_ids,
    assigned_loksabha_ids: actor.assigned_loksabha_ids,
    assigned_assembly_ids: actor.assigned_assembly_ids,
    effective_group_ids: actor.effective_group_ids,
  });
}

/** Read-path denials only — allows are not logged to avoid audit noise. Mutations use auditRbacMutation (allow + deny). */
function recordDecision(
  actor: RbacActor,
  action: string,
  decision: PermissionDecision,
  resource_type?: string,
  resource_id?: string
): PermissionDecision {
  logPermissionDecisionFromDebug({
      user_id: actor.id,
      role: actor.role,
      action,
      resource_type: resource_type ?? null,
      resource_id: resource_id ?? null,
      allowed: decision.allowed,
      denied_reason: decision.denied_reason ?? null,
      debug: decision.debug,
    });
  return decision;
}

function isFullAdmin(role: string): boolean {
  return role === 'admin' || role === 'super_admin';
}

function ownsResource(actorId: string, createdBy: unknown): boolean {
  const owner = normalizeActorId(createdBy);
  return !!owner && owner === normalizeActorId(actorId);
}

export { eventVisibilityMatch } from '@/lib/rbac/event-visibility-engine';

/**
 * Subset scope check: resource targeting must fit inside actor assignments.
 * Empty resource dimension = no extra restriction inside actor scope (not global).
 */
export function canAccessScope(
  actor: Pick<
    RbacActor,
    | 'role'
    | 'assigned_state_ids'
    | 'assigned_group_ids'
    | 'assigned_party_ids'
    | 'assigned_loksabha_ids'
    | 'assigned_assembly_ids'
    | 'effective_group_ids'
  > & { id?: string },
  resourceScope: CanonicalScope | Record<string, unknown>
): PermissionDecision {
  const normalized_scope = actorScope(actor);
  const resource = typeof (resourceScope as CanonicalScope).state_ids !== 'undefined'
    ? (resourceScope as CanonicalScope)
    : normalizeResourceScope(resourceScope as Record<string, unknown>);

  const debug: RbacDebugPayload = {
    role: actor.role,
    normalized_scope,
    ownership_match: false,
    visibility_match: false,
    mutation_permission: false,
    action: 'canAccessScope',
  };

  if (isFullAdmin(actor.role)) {
    debug.mutation_permission = true;
    return { allowed: true, debug };
  }

  if (isGlobalTargeting(resource)) {
    debug.denied_reason = 'global_targeting_admin_only';
    logRbacDebug('canAccessScope', debug);
    return { allowed: false, denied_reason: debug.denied_reason, debug };
  }

  if (resource.state_ids.length > 0) {
    if (normalized_scope.state_ids.length === 0) {
      debug.denied_reason = 'actor_missing_state_scope';
      logRbacDebug('canAccessScope', debug);
      return { allowed: false, denied_reason: debug.denied_reason, debug };
    }
    const set = new Set(normalized_scope.state_ids);
    if (!resource.state_ids.every((id) => set.has(id))) {
      debug.denied_reason = 'state_outside_assignment';
      logRbacDebug('canAccessScope', debug);
      return { allowed: false, denied_reason: debug.denied_reason, debug };
    }
  }

  if (resource.party_ids.length > 0 || resource.party_slugs.length > 0) {
    const actorHasPartyLimit =
      normalized_scope.party_ids.length > 0 || normalized_scope.party_slugs.length > 0;
    if (actorHasPartyLimit && !partyOverlap(resource, normalized_scope)) {
      debug.denied_reason = 'party_outside_assignment';
      logRbacDebug('canAccessScope', debug);
      return { allowed: false, denied_reason: debug.denied_reason, debug };
    }
  }

  if (resource.loksabha_ids.length > 0) {
    if (normalized_scope.loksabha_ids.length === 0) {
      debug.denied_reason = 'actor_missing_loksabha_scope';
      logRbacDebug('canAccessScope', debug);
      return { allowed: false, denied_reason: debug.denied_reason, debug };
    }
    const set = new Set(normalized_scope.loksabha_ids);
    if (!resource.loksabha_ids.every((id) => set.has(id))) {
      debug.denied_reason = 'loksabha_outside_assignment';
      logRbacDebug('canAccessScope', debug);
      return { allowed: false, denied_reason: debug.denied_reason, debug };
    }
  }

  if (resource.assembly_ids.length > 0) {
    if (normalized_scope.assembly_ids.length === 0) {
      debug.denied_reason = 'actor_missing_assembly_scope';
      logRbacDebug('canAccessScope', debug);
      return { allowed: false, denied_reason: debug.denied_reason, debug };
    }
    const set = new Set(normalized_scope.assembly_ids);
    if (!resource.assembly_ids.every((id) => set.has(id))) {
      debug.denied_reason = 'assembly_outside_assignment';
      logRbacDebug('canAccessScope', debug);
      return { allowed: false, denied_reason: debug.denied_reason, debug };
    }
  }

  if (resource.group_ids.length > 0) {
    if (normalized_scope.group_ids.length === 0) {
      debug.denied_reason = 'actor_missing_group_scope';
      logRbacDebug('canAccessScope', debug);
      return { allowed: false, denied_reason: debug.denied_reason, debug };
    }
    const set = new Set(normalized_scope.group_ids);
    if (!resource.group_ids.every((g) => set.has(g))) {
      debug.denied_reason = 'group_outside_assignment';
      logRbacDebug('canAccessScope', debug);
      return { allowed: false, denied_reason: debug.denied_reason, debug };
    }
  }

  debug.mutation_permission = true;
  return { allowed: true, debug };
}

function baseEventDebug(actor: RbacActor, event: NormalizedEventResource, action: string): RbacDebugPayload {
  return {
    role: actor.role,
    normalized_scope: actorScope(actor),
    ownership_match: ownsResource(actor.id, event.created_by),
    visibility_match: false,
    mutation_permission: false,
    action,
  };
}

export function canViewEvent(actor: RbacActor, rawEvent: Record<string, unknown>): PermissionDecision {
  const event = normalizeEventResource(rawEvent);
  const debug = baseEventDebug(actor, event, 'canViewEvent');

  if (isEventVisibleToActor(actor, rawEvent)) {
    debug.visibility_match = true;
    debug.mutation_permission = ownsResource(actor.id, event.created_by) || isFullAdmin(actor.role);
    logRbacDebug('canViewEvent', debug);
    return { allowed: true, debug };
  }

  debug.denied_reason = 'event_not_visible';
  logRbacDebug('canViewEvent', debug);
  return recordDecision(actor, 'canViewEvent', { allowed: false, denied_reason: debug.denied_reason, debug }, 'events', String(rawEvent.id ?? ''));
}

export function canEditEvent(actor: RbacActor, rawEvent: Record<string, unknown>): PermissionDecision {
  const event = normalizeEventResource(rawEvent);
  const debug = baseEventDebug(actor, event, 'canEditEvent');

  if (isFullAdmin(actor.role)) {
    debug.mutation_permission = true;
    return { allowed: true, debug };
  }

  if (actor.role === 'editor') {
    if (ownsResource(actor.id, event.created_by)) {
      debug.mutation_permission = true;
      return { allowed: true, debug };
    }
    debug.denied_reason = 'editor_may_only_edit_own_events';
    logRbacDebug('canEditEvent', debug);
    return { allowed: false, denied_reason: debug.denied_reason, debug };
  }

  if (actor.role === 'moderator' || actor.role === 'campaign_manager') {
    if (ownsResource(actor.id, event.created_by)) {
      debug.mutation_permission = true;
      return { allowed: true, debug };
    }
    debug.denied_reason = 'cannot_edit_others_events';
    logRbacDebug('canEditEvent', debug);
    return recordDecision(actor, 'edit_event', { allowed: false, denied_reason: debug.denied_reason, debug }, 'events', String(rawEvent.id ?? ''));
  }

  debug.denied_reason = 'role_cannot_edit_events';
  logRbacDebug('canEditEvent', debug);
  return recordDecision(actor, 'edit_event', { allowed: false, denied_reason: debug.denied_reason, debug }, 'events', String(rawEvent.id ?? ''));
}

export function canDeleteEvent(actor: RbacActor, rawEvent: Record<string, unknown>): PermissionDecision {
  const d = canEditEvent(actor, rawEvent);
  if (!d.allowed) {
    return recordDecision(actor, 'delete_event', d, 'events', String(rawEvent.id ?? ''));
  }
  return d;
}

export function canUploadPost(actor: RbacActor, rawEvent: Record<string, unknown>): PermissionDecision {
  const event = normalizeEventResource(rawEvent);
  const debug = baseEventDebug(actor, event, 'canUploadPost');

  if (isFullAdmin(actor.role)) {
    debug.mutation_permission = true;
    return { allowed: true, debug };
  }

  if (actor.role === 'editor') {
    if (ownsResource(actor.id, event.created_by)) {
      debug.mutation_permission = true;
      return { allowed: true, debug };
    }
    debug.denied_reason = 'editor_may_only_upload_to_own_events';
    logRbacDebug('canUploadPost', debug);
    return { allowed: false, denied_reason: debug.denied_reason, debug };
  }

  if (actor.role === 'moderator') {
    if (ownsResource(actor.id, event.created_by)) {
      debug.mutation_permission = true;
      return { allowed: true, debug };
    }
    const scope = canAccessScope(actor, event);
    if (scope.allowed && event.state_ids.length > 0) {
      debug.mutation_permission = true;
      debug.visibility_match = true;
      return { allowed: true, debug };
    }
    debug.denied_reason = scope.denied_reason ?? 'moderator_event_outside_scope';
    logRbacDebug('canUploadPost', debug);
    return { allowed: false, denied_reason: debug.denied_reason, debug };
  }

  if (actor.role === 'campaign_manager') {
    if (ownsResource(actor.id, event.created_by)) {
      debug.mutation_permission = true;
      return { allowed: true, debug };
    }
    const hasConstituencyAnchor =
      event.group_ids.length > 0 || event.loksabha_ids.length > 0 || event.assembly_ids.length > 0;
    if (!hasConstituencyAnchor) {
      debug.denied_reason = 'campaign_manager_event_missing_constituency_anchor';
      logRbacDebug('canUploadPost', debug);
      return recordDecision(actor, 'upload_post', { allowed: false, denied_reason: debug.denied_reason, debug }, 'events', String(rawEvent.id ?? ''));
    }
    const scope = canAccessScope(actor, event);
    if (scope.allowed) {
      debug.mutation_permission = true;
      debug.visibility_match = true;
      return { allowed: true, debug };
    }
    debug.denied_reason = scope.denied_reason ?? 'campaign_manager_event_outside_scope';
    logRbacDebug('canUploadPost', debug);
    return recordDecision(actor, 'upload_post', { allowed: false, denied_reason: debug.denied_reason, debug }, 'events', String(rawEvent.id ?? ''));
  }

  debug.denied_reason = 'role_cannot_upload_posts';
  logRbacDebug('canUploadPost', debug);
  return recordDecision(actor, 'upload_post', { allowed: false, denied_reason: debug.denied_reason, debug }, 'events', String(rawEvent.id ?? ''));
}

export function canCreateGroup(actor: RbacActor): PermissionDecision {
  const debug: RbacDebugPayload = {
    role: actor.role,
    normalized_scope: actorScope(actor),
    ownership_match: false,
    visibility_match: false,
    mutation_permission: false,
    action: 'canCreateGroup',
  };

  if (isFullAdmin(actor.role)) {
    debug.mutation_permission = true;
    return { allowed: true, debug };
  }

  if (actor.role === 'moderator') {
    debug.mutation_permission = true;
    return { allowed: true, debug };
  }

  debug.denied_reason = 'role_cannot_create_groups';
  logRbacDebug('canCreateGroup', debug);
  return recordDecision(actor, 'group_create', { allowed: false, denied_reason: debug.denied_reason, debug }, 'groups');
}

export function canTargetAudience(
  actor: RbacActor,
  targeting: Record<string, unknown> | CanonicalScope
): PermissionDecision {
  const resource =
    typeof (targeting as CanonicalScope).state_ids !== 'undefined'
      ? (targeting as CanonicalScope)
      : normalizeResourceScope(targeting);

  const debug: RbacDebugPayload = {
    role: actor.role,
    normalized_scope: actorScope(actor),
    ownership_match: false,
    visibility_match: false,
    mutation_permission: false,
    action: 'canTargetAudience',
  };

  if (isFullAdmin(actor.role)) {
    debug.mutation_permission = true;
    return { allowed: true, debug };
  }

  if (isGlobalTargeting(resource, { dashboard_category: (targeting as Record<string, unknown>)?.dashboard_category })) {
    debug.denied_reason = 'global_targeting_admin_only';
    logRbacDebug('canTargetAudience', debug);
    return { allowed: false, denied_reason: debug.denied_reason, debug };
  }

  const scopeCheck = canAccessScope(actor, resource);
  if (!scopeCheck.allowed) {
    debug.denied_reason = scopeCheck.denied_reason;
    logRbacDebug('canTargetAudience', debug);
    return recordDecision(actor, 'canTargetAudience', { allowed: false, denied_reason: debug.denied_reason, debug }, 'notifications');
  }

  debug.mutation_permission = true;
  return { allowed: true, debug };
}

/** Filter in-memory event rows using unified visibility (prefer DB {@link getEventVisibilityQuery}). */
export function filterVisibleEvents<T extends Record<string, unknown>>(
  actor: RbacActor,
  rows: T[]
): T[] {
  return rows.filter((row) => isEventVisibleToActor(actor, row));
}
