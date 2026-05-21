/**
 * UI capability mapper — no permission logic; binds permission-engine to React pages.
 */
import {
  canAccessDashboardModule,
  canUseGlobalFilters,
  getDashboardFilterVisibility,
  getEventFormUiCapabilities,
  type DashboardActor,
  type DashboardModuleId,
  type EventFormUiCapabilities,
} from '@/lib/rbac/dashboard-permissions';
import {
  canCreateGroup,
  canDeleteEvent,
  canEditEvent,
  canTargetAudience,
  canUploadPost,
  canViewEvent,
  type RbacActor,
} from '@/lib/rbac/permission-engine';
import { toRbacActorForEventRead } from '@/lib/rbac/editor-scope';
import { getCachedNormalizedScope } from '@/lib/rbac/scope-cache';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';

export type { EventFormUiCapabilities, EventFormUiMode } from '@/lib/rbac/dashboard-permissions';

export type UiPermissionBundle = {
  actor: RbacActor;
  normalized_scope: ReturnType<typeof getCachedNormalizedScope>;
  filterVisibility: ReturnType<typeof getDashboardFilterVisibility>;
  canUseGlobalFilters: boolean;
  canAccessModule: (module: DashboardModuleId) => boolean;
  canViewEvent: (row: Record<string, unknown>) => boolean;
  canEditEvent: (row: Record<string, unknown>) => boolean;
  canDeleteEvent: (row: Record<string, unknown>) => boolean;
  canUploadPost: (row: Record<string, unknown>) => boolean;
  canCreateGroup: () => boolean;
  events: EventFormUiCapabilities;
};

export function getEventUiCapabilities(actor: RbacActor): EventFormUiCapabilities {
  return getEventFormUiCapabilities(actor);
}

export function buildUiPermissions(actor: DashboardActor): UiPermissionBundle {
  const rbacActor: RbacActor = {
    id: actor.id,
    role: actor.role,
    assigned_state_ids: actor.assigned_state_ids,
    assigned_group_ids: actor.assigned_group_ids,
    assigned_party_ids: actor.assigned_party_ids,
    assigned_loksabha_ids: actor.assigned_loksabha_ids,
    assigned_assembly_ids: actor.assigned_assembly_ids,
    effective_group_ids: actor.effective_group_ids,
  };

  const readActor = toRbacActorForEventRead({
    role: actor.role as VerifiedAdminAuth['role'],
    user: { id: actor.id },
    assigned_state_ids: actor.assigned_state_ids,
    assigned_group_ids: actor.assigned_group_ids,
    assigned_party_ids: actor.assigned_party_ids,
    assigned_loksabha_ids: actor.assigned_loksabha_ids ?? [],
    assigned_assembly_ids: actor.assigned_assembly_ids ?? [],
  });

  return {
    actor: rbacActor,
    normalized_scope: getCachedNormalizedScope(rbacActor),
    filterVisibility: getDashboardFilterVisibility(actor),
    canUseGlobalFilters: canUseGlobalFilters(actor),
    canAccessModule: (module) => canAccessDashboardModule(actor, module),
    canViewEvent: (row) => canViewEvent(readActor, row).allowed,
    canEditEvent: (row) => canEditEvent(rbacActor, row).allowed,
    canDeleteEvent: (row) => canDeleteEvent(rbacActor, row).allowed,
    canUploadPost: (row) => canUploadPost(rbacActor, row).allowed,
    canCreateGroup: () => canCreateGroup(rbacActor).allowed,
    events: getEventFormUiCapabilities(rbacActor),
  };
}

export function canTargetAudienceUi(
  actor: DashboardActor,
  targeting: Record<string, unknown>
): boolean {
  return canTargetAudience(
    {
      id: actor.id,
      role: actor.role,
      assigned_state_ids: actor.assigned_state_ids,
      assigned_group_ids: actor.assigned_group_ids,
      assigned_party_ids: actor.assigned_party_ids,
    },
    targeting
  ).allowed;
}
