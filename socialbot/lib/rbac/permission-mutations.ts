/**
 * Mutation gate — all write authorization flows through permission-engine primitives.
 */
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { isActiveEventDashboardCategory } from '@/lib/dashboard-event-category';
import {
  canAccessScope,
  canCreateGroup,
  canDeleteEvent,
  canEditEvent,
  canTargetAudience,
  canUploadPost,
  type RbacActor,
} from '@/lib/rbac/permission-engine';
import {
  hasConstituencyAnchor,
  normalizeResourceScope,
  scopeDimensionWildcard,
} from '@/lib/rbac/normalize-scope';
import { isAdminRole, isElevatedDashboardRole } from '@/lib/rbac/dashboard-permissions';
import { normalizeActorId } from '@/lib/rbac/require';
import { auditRbacMutation } from '@/lib/rbac/permission-audit';
import { evaluateAnomaliesForUser, trackRbacEvent } from '@/lib/rbac/rbac-observability-engine';
import { emitRbacAlerts } from '@/lib/rbac/rbac-alert-engine';
import { rbacScopeMetadataFromUser } from '@/lib/rbac/scope-observability';
import { resolveScope, type UnifiedResource, type UnifiedUser } from '@/lib/rbac/unified-scope-engine';
import {
  auditUnsupportedResourceUsage,
  canUseOwnershipFallback,
  validateRegisteredResourceForLayer,
} from '@/lib/rbac/resource-classification';

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
  | 'twitter_campaigns.retry_notifications'
  | 'parties.create'
  | 'parties.update'
  | 'parties.delete'
  | 'banners.create'
  | 'banners.update'
  | 'banners.delete'
  | 'user_frames.create'
  | 'user_frames.delete'
  | 'storage.upload'
  | 'storage.delete'
  | 'profiles.role_update';

export type MutationDecision =
  | { ok: true }
  | { ok: false; reason: string; details?: Record<string, unknown> };

type MutationAuditCtx = {
  resourceType: string;
  resourceId?: string | null;
  resourceName?: string | null;
};

/** Persists allow/deny to rbac_audit_logs; denial also triggers observability + admin_action. */
function auditMutationOutcome(
  user: UnifiedUser,
  action: MutationAction,
  ctx: MutationAuditCtx,
  outcome: { allowed: boolean; reason?: string; details?: Record<string, unknown> }
): void {
  void auditRbacMutation({
    user_id: user.id,
    role: user.role,
    mutation_action: action,
    resource_type: ctx.resourceType,
    resource_id: ctx.resourceId ?? null,
    allowed: outcome.allowed,
    denied_reason: outcome.allowed ? null : (outcome.reason ?? 'forbidden'),
    metadata: {
      ...(outcome.details ?? {}),
      ...(ctx.resourceName ? { resource_name: ctx.resourceName } : {}),
    },
  });
  if (!outcome.allowed) {
    mutationDenialObservability(user, action, ctx, outcome.reason ?? 'forbidden', outcome.details);
  }
}

function mutationDenialObservability(
  user: UnifiedUser,
  action: MutationAction,
  ctx: MutationAuditCtx,
  reason: string,
  details?: Record<string, unknown>
): void {
  const scope = resolveScope(user);
  const scopeMeta = rbacScopeMetadataFromUser(user);
  void trackRbacEvent({
    user_id: user.id,
    role: user.role,
    event_type: 'mutation',
    action,
    resource_type: ctx.resourceType,
    resource_id: ctx.resourceId ?? null,
    result: 'denied',
    scope_state_ids: scope.type === 'STATE' ? scope.states : [],
    scope_group_ids: scope.type === 'GROUP' ? scope.groups : [],
    severity: 'warning',
    metadata: { denied: true, reason, ...scopeMeta, ...(details ?? {}) },
  });
  void (async () => {
    const signals = await evaluateAnomaliesForUser({ user_id: user.id, role: user.role });
    if (signals.length > 0) {
      for (const s of signals) {
        void trackRbacEvent({
          user_id: user.id,
          role: user.role,
          event_type: s.event_type,
          action: s.action,
          resource_type: ctx.resourceType,
          resource_id: ctx.resourceId ?? null,
          result: 'denied',
          severity: s.severity,
          scope_state_ids: scope.type === 'STATE' ? scope.states : [],
          scope_group_ids: scope.type === 'GROUP' ? scope.groups : [],
          metadata: s.metadata,
        });
      }
      await emitRbacAlerts({ user_id: user.id, role: user.role, signals });
    }
  })();
  void logAdminAction({
    actor_user_id: user.id,
    actor_role: user.role,
    action_type: `${action}.denied`,
    resource_type: ctx.resourceType,
    resource_id: ctx.resourceId ?? null,
    resource_name: ctx.resourceName ?? null,
    severity: 'warning',
    undoable: false,
    metadata: { denied: true, reason, ...scopeMeta, ...(details ?? {}) },
    scope_state_ids: scope.type === 'STATE' ? scope.states : [],
    scope_group_ids: scope.type === 'GROUP' ? scope.groups : [],
  });
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

function ownsResource(userId: string, createdBy: unknown): boolean {
  const owner = normalizeActorId(createdBy);
  return !!owner && owner === normalizeActorId(userId);
}

function effectiveResourceScope(
  resource: UnifiedResource | null,
  payload: Record<string, unknown> | null
): Record<string, unknown> {
  const payloadFilters = ((payload as { filters?: unknown })?.filters ?? null) as Record<string, unknown> | null;
  return {
    created_by: (resource as { created_by?: unknown })?.created_by ?? (payload as { created_by?: unknown })?.created_by,
    state_id:
      (resource as { state_ids?: unknown })?.state_ids ??
      (payload as { state_id?: unknown })?.state_id ??
      (payload as { assigned_state_ids?: unknown })?.assigned_state_ids ??
      payloadFilters?.assigned_state_ids,
    group_id: (resource as { group_id?: unknown })?.group_id ?? (payload as { group_id?: unknown })?.group_id,
    target_groups:
      (resource as { group_ids?: unknown })?.group_ids ??
      (payload as { target_groups?: unknown })?.target_groups ??
      (payload as { group_ids?: unknown })?.group_ids ??
      payloadFilters?.group_ids,
    dashboard_category:
      (resource as { dashboard_category?: unknown })?.dashboard_category ??
      (payload as { dashboard_category?: unknown })?.dashboard_category,
    loksabha_id:
      (resource as { loksabha_id?: unknown })?.loksabha_id ??
      (resource as { loksabha_ids?: unknown })?.loksabha_ids ??
      (payload as { loksabha_id?: unknown })?.loksabha_id ??
      (payload as { loksabha?: unknown })?.loksabha,
    assembly_id:
      (resource as { assembly_id?: unknown })?.assembly_id ??
      (resource as { assembly_ids?: unknown })?.assembly_ids ??
      (payload as { assembly_id?: unknown })?.assembly_id ??
      (payload as { assembly?: unknown })?.assembly,
  };
}

function resourceHasMutationScope(scopeNorm: ReturnType<typeof normalizeResourceScope>): boolean {
  if (scopeNorm.state_ids.length > 0 || scopeNorm.group_ids.length > 0) return true;
  if (scopeNorm.loksabha_ids.length > 0 || scopeNorm.assembly_ids.length > 0) return true;
  if (scopeDimensionWildcard(scopeNorm, 'loksabha') || scopeDimensionWildcard(scopeNorm, 'assembly')) {
    return true;
  }
  return hasConstituencyAnchor(scopeNorm);
}

/**
 * Central mutation RBAC guard (permission-engine only).
 * Must be called before any DB write.
 */
export function canPerformMutation(
  user: UnifiedUser,
  action: MutationAction,
  resource: UnifiedResource | Record<string, unknown> | null = null,
  payload: Record<string, unknown> | null = null,
  audit?: { resourceType: string; resourceId?: string | null; resourceName?: string | null }
): MutationDecision {
  const auditCtx: MutationAuditCtx | null = audit
    ? {
        resourceType: audit.resourceType,
        resourceId: audit.resourceId,
        resourceName: audit.resourceName,
      }
    : null;
  const allow = (): MutationDecision => {
    if (auditCtx) auditMutationOutcome(user, action, auditCtx, { allowed: true });
    return { ok: true };
  };
  const deny = (reason: string, details?: Record<string, unknown>): MutationDecision => {
    const scopeMeta = rbacScopeMetadataFromUser(user);
    const merged = { ...scopeMeta, ...(details ?? {}) };
    if (auditCtx) auditMutationOutcome(user, action, auditCtx, { allowed: false, reason, details: merged });
    return { ok: false, reason, details: merged };
  };

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
    return deny(resourceValidation.reason);
  }

  if (
    resourceType === 'parties' &&
    (action === 'parties.create' || action === 'parties.update' || action === 'parties.delete')
  ) {
    if (!isElevatedDashboardRole(user.role)) return deny('Forbidden: parties are admin-only');
    return allow();
  }

  if (
    resourceType === 'dashboard_banners' &&
    (action === 'banners.create' || action === 'banners.update' || action === 'banners.delete')
  ) {
    if (!isElevatedDashboardRole(user.role)) return deny('Forbidden: banners require elevated admin');
    return allow();
  }

  if (
    resourceType === 'user_frames' &&
    (action === 'user_frames.create' || action === 'user_frames.delete')
  ) {
    if (isElevatedDashboardRole(user.role) || isAdminRole(user.role)) return allow();
    const actor = toActor(user);
    const scopeNorm = normalizeResourceScope((resource ?? {}) as Record<string, unknown>);
    if (scopeNorm.state_ids.length > 0 || scopeNorm.group_ids.length > 0) {
      const scopeDecision = canAccessScope(actor, scopeNorm);
      if (scopeDecision.allowed) return allow();
      return deny(scopeDecision.denied_reason ?? 'Forbidden: target user outside scope');
    }
    return deny('Forbidden: missing profile scope for user frames');
  }

  if (resourceType === 'profiles' && action === 'profiles.role_update') {
    if (!isElevatedDashboardRole(user.role)) {
      return deny('Forbidden: only elevated admins can update roles');
    }
    return allow();
  }

  if (action === 'profiles.bulk_tags') {
    if (isElevatedDashboardRole(user.role) || isAdminRole(user.role)) return allow();
    if (user.role === 'moderator' || user.role === 'campaign_manager') return allow();
    if (user.role === 'editor') return deny('Forbidden: editor cannot bulk-update profile tags');
    return deny('Forbidden: cannot bulk-update profile tags');
  }

  if (user.role === 'editor' && action === 'groups.create') {
    return deny('Forbidden: editor cannot create groups');
  }

  if (action === 'profiles.delete') {
    if (isElevatedDashboardRole(user.role) || isAdminRole(user.role)) return allow();
    if (user.role === 'campaign_manager') return allow();
    return deny('Forbidden: profiles.delete requires admin or campaign manager scope');
  }

  if (action === 'groups.members.add' || action === 'groups.members.remove') {
    if (isAdminRole(user.role) || user.role === 'super_admin') return allow();
    if (user.role === 'moderator') {
      const owner = (resource as { created_by?: unknown })?.created_by;
      if (!ownsResource(user.id, owner)) {
        return deny('Forbidden: moderator may only manage members of own groups');
      }
      return allow();
    }
    if (user.role === 'campaign_manager') return allow();
    return deny('Forbidden: cannot modify group members');
  }

  if (
    resourceType === 'storage' &&
    (action === 'storage.upload' || action === 'storage.delete')
  ) {
    if (isAdminRole(user.role) || user.role === 'super_admin') return allow();
    const actor = toActor(user);
    const bucket = String((payload as { bucket?: unknown })?.bucket ?? '').trim();
    const targetKind = String((resource as { target_kind?: unknown })?.target_kind ?? '').trim();

    if (user.role === 'editor') {
      if (bucket !== 'post-images') {
        return deny('Forbidden: editor may only use post-images bucket');
      }
      if (targetKind !== 'event') return deny('Forbidden: editor storage target must be an event');
      const upload = canUploadPost(actor, (resource ?? {}) as Record<string, unknown>);
      if (!upload.allowed) return deny(upload.denied_reason ?? 'Forbidden: cannot upload to this event');
      return allow();
    }

    if (user.role === 'campaign_manager') {
      if (bucket !== 'post-images') {
        return deny('Forbidden: campaign_manager can only use post-images bucket');
      }
      if (targetKind !== 'event') return deny('Forbidden: campaign_manager storage target must be an event');
      const upload = canUploadPost(actor, (resource ?? {}) as Record<string, unknown>);
      if (!upload.allowed) return deny(upload.denied_reason ?? 'Forbidden: cannot upload to this event');
      return allow();
    }

    if (user.role === 'moderator') {
      if (user.assigned_state_ids.length === 0) {
        return deny('Forbidden: moderator is missing assigned_state_ids');
      }
      if (bucket === 'user-frames') {
        if (targetKind !== 'profile') return deny('Forbidden: moderator user-frames target must be a profile');
        const scopeNorm = normalizeResourceScope({
          state_ids: (resource as { assigned_state_ids?: unknown })?.assigned_state_ids,
        });
        const scopeDecision = canAccessScope(actor, scopeNorm);
        if (!scopeDecision.allowed) {
          return deny(scopeDecision.denied_reason ?? 'Forbidden: user outside moderator assigned states');
        }
        return allow();
      }
      if (bucket === 'post-images') {
        if (targetKind !== 'event') return deny('Forbidden: moderator event storage target must be an event');
        const upload = canUploadPost(actor, (resource ?? {}) as Record<string, unknown>);
        if (!upload.allowed) return deny(upload.denied_reason ?? 'Forbidden: cannot upload to this event');
        return allow();
      }
      return deny('Forbidden: moderator may only use post-images or user-frames buckets');
    }

    return deny('Forbidden: role cannot perform storage mutation');
  }

  if (isAdminRole(user.role)) return allow();

  const actor = toActor(user);

  if (action === 'groups.create') {
    const g = canCreateGroup(actor);
    if (!g.allowed) return deny(g.denied_reason ?? 'Forbidden: cannot create groups');
    return allow();
  }

  const eventRow = resource as Record<string, unknown> | null;
  if (resourceType === 'events' && eventRow) {
    if (action === 'events.delete') {
      const d = canDeleteEvent(actor, eventRow);
      if (!d.allowed) return deny(d.denied_reason ?? 'Forbidden: cannot delete event');
      return allow();
    }
    if (action === 'events.update' || action === 'events.publish' || action === 'events.archive' || action === 'events.schedule') {
      const d = canEditEvent(actor, eventRow);
      if (!d.allowed) return deny(d.denied_reason ?? 'Forbidden: cannot edit event');
    }
  }

  const targetingPayload = { ...(payload ?? {}), ...(resource ?? {}) } as Record<string, unknown>;
  if (
    resourceType === 'events' &&
    (action === 'events.create' || action === 'events.update') &&
    Object.keys(targetingPayload).length > 0
  ) {
    const t = canTargetAudience(actor, targetingPayload);
    if (!t.allowed) return deny(t.denied_reason ?? 'Forbidden: targeting not allowed');
    const scope = canAccessScope(actor, normalizeResourceScope(targetingPayload));
    if (!scope.allowed && action === 'events.create') {
      return deny(scope.denied_reason ?? 'Forbidden: outside scope', scope.debug as unknown as Record<string, unknown>);
    }
  }

  const mutationResourceOwner = (resource as { created_by?: unknown } | null)?.created_by;

  if (
    (action === 'posts.create' || action === 'posts.update') &&
    resourceType === 'posts' &&
    (user.role === 'moderator' || user.role === 'campaign_manager') &&
    ownsResource(user.id, mutationResourceOwner)
  ) {
    return allow();
  }

  const effective = effectiveResourceScope(resource, payload);

  if (user.role === 'editor') {
    if (
      (action === 'events.create' || action === 'events.update') &&
      isActiveEventDashboardCategory(effective.dashboard_category)
    ) {
      return deny('Forbidden: editor cannot create global dashboard events');
    }
    if (action === 'events.create') return allow();
    if ((action === 'events.update' || action === 'events.delete') && eventRow) {
      const d = action === 'events.delete' ? canDeleteEvent(actor, eventRow) : canEditEvent(actor, eventRow);
      if (d.allowed) return allow();
      return deny(d.denied_reason ?? 'Forbidden: editor may only manage own events');
    }
    if ((action === 'posts.create' || action === 'posts.update') && ownsResource(user.id, mutationResourceOwner)) {
      return allow();
    }
    return deny('Forbidden: editor may only manage own events and posts');
  }

  if (
    action === 'events.create' &&
    isActiveEventDashboardCategory(effective.dashboard_category) &&
    user.role === 'moderator'
  ) {
    return deny('Forbidden: moderator cannot create global dashboard events');
  }

  if (
    action === 'events.update' &&
    isActiveEventDashboardCategory(effective.dashboard_category) &&
    user.role === 'moderator'
  ) {
    return deny('Forbidden: moderator cannot set global dashboard category');
  }

  if (
    (action === 'events.create' || action === 'events.update') &&
    isActiveEventDashboardCategory(effective.dashboard_category) &&
    user.role === 'campaign_manager'
  ) {
    return allow();
  }

  const scopeNorm = normalizeResourceScope(effective);
  if (resourceHasMutationScope(scopeNorm)) {
    const scopeDecision = canAccessScope(actor, scopeNorm);
    if (scopeDecision.allowed) return allow();
    return deny(
      scopeDecision.denied_reason ?? 'Forbidden: outside scope',
      scopeDecision.debug as unknown as Record<string, unknown>
    );
  }

  const allowOwnershipFallback = canUseOwnershipFallback(resourceType);
  if (allowOwnershipFallback && ownsResource(user.id, effective.created_by)) {
    return allow();
  }

  return deny('Forbidden: missing scope', { state_ids: scopeNorm.state_ids, group_ids: scopeNorm.group_ids });
}
