/**
 * Dashboard module + filter entitlements — delegates to permission-engine for all decisions.
 * Routing (paths/API prefixes) stays in dashboard-access.ts.
 */
import type { AdminPanelRole } from '@/lib/profile-roles';
import { canCreateGroup, type RbacActor } from '@/lib/rbac/permission-engine';
import { getCachedNormalizedScope } from '@/lib/rbac/scope-cache';
import type { CanonicalScope } from '@/lib/rbac/scope-types';
import type { DashboardModuleId } from '@/lib/rbac/dashboard-module-ids';
import { ALL_DASHBOARD_MODULE_IDS } from '@/lib/rbac/dashboard-module-ids';

export type { DashboardModuleId };

export type DashboardActor = {
  id: string;
  role: AdminPanelRole;
  assigned_state_ids: number[];
  assigned_group_ids: string[];
  assigned_party_ids: string[];
  assigned_loksabha_ids?: number[];
  assigned_assembly_ids?: number[];
  effective_group_ids?: string[];
};

export type DashboardFilterVisibility = {
  canUseGlobalFilters: boolean;
  showStateFilter: boolean;
  showPartyFilter: boolean;
  showGroupFilter: boolean;
  showLokSabhaFilter: boolean;
  showAssemblyFilter: boolean;
  allowGlobalAllOption: boolean;
  active_scope: CanonicalScope;
};

export type EventFormUiMode = 'admin' | 'moderator' | 'campaign_manager' | 'editor' | 'denied';

export type EventFormUiCapabilities = {
  mode: EventFormUiMode;
  adminForm: boolean;
  moderatorForm: boolean;
  campaignManagerForm: boolean;
  editorForm: boolean;
  partyScopeRestricted: boolean;
  lockCreateStateToScope: boolean;
  canUseGlobalTargeting: boolean;
  canManageGroups: boolean;
  canSchedulePublish: boolean;
  showAllStateOption: boolean;
  showAllPartyOption: boolean;
  showGroupTargeting: boolean;
  showGeoTargeting: boolean;
  requireStateSelection: boolean;
  /** Editor: "Select all" for lok sabha / assembly within assigned profile scope only. */
  showAllAssignedGeoOption: boolean;
};

const ROLE_MODULES: Record<AdminPanelRole, readonly DashboardModuleId[]> = {
  admin: ALL_DASHBOARD_MODULE_IDS,
  super_admin: ALL_DASHBOARD_MODULE_IDS,
  moderator: [
    'dashboard',
    'events',
    'users',
    'leaderboard',
    'analytics',
    'group_management',
    'broadcast',
    'twitter_campaign',
  ],
  campaign_manager: [
    'events',
    'users',
    'leaderboard',
    'analytics',
    'group_management',
    'broadcast',
    'twitter_campaign',
  ],
  editor: ['events'],
};

function normalizeRole(role: string | null | undefined): AdminPanelRole | null {
  const r = String(role ?? '').trim().toLowerCase();
  if (r === 'super_admin') return 'admin';
  if (
    r === 'admin' ||
    r === 'moderator' ||
    r === 'campaign_manager' ||
    r === 'editor'
  ) {
    return r as AdminPanelRole;
  }
  return null;
}

function toRbacActor(actor: DashboardActor): RbacActor {
  return {
    id: actor.id,
    role: actor.role,
    assigned_state_ids: actor.assigned_state_ids,
    assigned_group_ids: actor.assigned_group_ids,
    assigned_party_ids: actor.assigned_party_ids,
    assigned_loksabha_ids: actor.assigned_loksabha_ids,
    assigned_assembly_ids: actor.assigned_assembly_ids,
    effective_group_ids: actor.effective_group_ids,
  };
}

export function isAdminRole(role: string | null | undefined): boolean {
  const r = normalizeRole(role);
  return r === 'admin';
}

/** Raw role check (admin or super_admin) — use for API gates before normalization. */
export function isElevatedDashboardRole(role: string | null | undefined): boolean {
  const r = String(role ?? '').trim().toLowerCase();
  return r === 'admin' || r === 'super_admin';
}

export function isModeratorRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === 'moderator';
}

export function isCampaignManagerRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === 'campaign_manager';
}

export function isEditorRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === 'editor';
}

export function getAllowedDashboardModules(actor: Pick<DashboardActor, 'role'>): DashboardModuleId[] {
  const role = normalizeRole(actor.role) ?? actor.role;
  if (role === 'admin' || role === 'super_admin') return [...ROLE_MODULES.admin];
  return [...(ROLE_MODULES[role] ?? [])];
}

export function canAccessDashboardModule(
  actor: Pick<DashboardActor, 'role'>,
  moduleId: DashboardModuleId
): boolean {
  return new Set(getAllowedDashboardModules(actor)).has(moduleId);
}

export function canUseGlobalFilters(actor: Pick<DashboardActor, 'role'>): boolean {
  return isAdminRole(actor.role);
}

export function getDashboardFilterVisibility(actor: DashboardActor): DashboardFilterVisibility {
  const global = canUseGlobalFilters(actor);
  const active_scope = getCachedNormalizedScope(toRbacActor(actor));
  const r = normalizeRole(actor.role);
  return {
    canUseGlobalFilters: global,
    showStateFilter: global || r === 'moderator',
    showPartyFilter: global || r === 'moderator' || r === 'campaign_manager',
    showGroupFilter: global || r === 'campaign_manager',
    showLokSabhaFilter: global || r === 'campaign_manager',
    showAssemblyFilter: global || r === 'campaign_manager',
    allowGlobalAllOption: global,
    active_scope,
  };
}

function withFormFlags(
  mode: EventFormUiMode,
  caps: Omit<
    EventFormUiCapabilities,
    | 'mode'
    | 'adminForm'
    | 'moderatorForm'
    | 'campaignManagerForm'
    | 'editorForm'
    | 'partyScopeRestricted'
    | 'lockCreateStateToScope'
  >
): EventFormUiCapabilities {
  return {
    mode,
    adminForm: mode === 'admin',
    moderatorForm: mode === 'moderator',
    campaignManagerForm: mode === 'campaign_manager',
    editorForm: mode === 'editor',
    partyScopeRestricted: mode === 'editor',
    lockCreateStateToScope: mode === 'moderator',
    ...caps,
  };
}

/** Event form UI profile — derived only from permission-engine + dashboard module entitlements. */
export function getEventFormUiCapabilities(actor: RbacActor): EventFormUiCapabilities {
  const dashActor: DashboardActor = {
    id: actor.id,
    role: actor.role as AdminPanelRole,
    assigned_state_ids: actor.assigned_state_ids,
    assigned_group_ids: actor.assigned_group_ids,
    assigned_party_ids: actor.assigned_party_ids,
    assigned_loksabha_ids: actor.assigned_loksabha_ids,
    assigned_assembly_ids: actor.assigned_assembly_ids,
    effective_group_ids: actor.effective_group_ids,
  };

  if (!canAccessDashboardModule(dashActor, 'events')) {
    return withFormFlags('denied', {
      canUseGlobalTargeting: false,
      canManageGroups: false,
      canSchedulePublish: false,
      showAllStateOption: false,
      showAllPartyOption: false,
      showGroupTargeting: false,
      showGeoTargeting: false,
      requireStateSelection: false,
      showAllAssignedGeoOption: true,
    });
  }

  if (canUseGlobalFilters(dashActor)) {
    return withFormFlags('admin', {
      canUseGlobalTargeting: true,
      canManageGroups: true,
      canSchedulePublish: true,
      showAllStateOption: true,
      showAllPartyOption: true,
      showGroupTargeting: true,
      showGeoTargeting: true,
      requireStateSelection: false,
      showAllAssignedGeoOption: false,
    });
  }

  const fv = getDashboardFilterVisibility(dashActor);
  const r = normalizeRole(actor.role);
  if (fv.showGroupFilter && !fv.showStateFilter) {
    return withFormFlags('campaign_manager', {
      canUseGlobalTargeting: false,
      canManageGroups: false,
      canSchedulePublish: false,
      showAllStateOption: false,
      showAllPartyOption: false,
      showGroupTargeting: true,
      showGeoTargeting: true,
      requireStateSelection: false,
      showAllAssignedGeoOption: true,
    });
  }

  if (fv.showStateFilter && canCreateGroup(actor).allowed) {
    return withFormFlags('moderator', {
      canUseGlobalTargeting: false,
      canManageGroups: true,
      canSchedulePublish: false,
      showAllStateOption: false,
      showAllPartyOption: false,
      showGroupTargeting: false,
      showGeoTargeting: true,
      requireStateSelection: true,
      showAllAssignedGeoOption: true,
    });
  }

  if (r === 'editor') {
    return withFormFlags('editor', {
      canUseGlobalTargeting: false,
      canManageGroups: false,
      canSchedulePublish: false,
      showAllStateOption: false,
      showAllPartyOption: false,
      showGroupTargeting: false,
      showGeoTargeting: true,
      requireStateSelection: true,
      showAllAssignedGeoOption: true,
    });
  }

  return withFormFlags('denied', {
    canUseGlobalTargeting: false,
    canManageGroups: false,
    canSchedulePublish: false,
    showAllStateOption: false,
    showAllPartyOption: false,
    showGroupTargeting: false,
    showGeoTargeting: false,
    requireStateSelection: false,
    showAllAssignedGeoOption: false,
  });
}
