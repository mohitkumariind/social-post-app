import {
  getAllowedModules,
  getDashboardFilterVisibility,
  toDashboardActor,
  type DashboardActor,
  type DashboardFilterVisibility,
  type DashboardModuleId,
} from '@/lib/rbac/dashboard-access';
import { buildUiPermissions, type UiPermissionBundle } from '@/lib/rbac/ui-capabilities';
import { ALL_DASHBOARD_MODULE_IDS } from '@/lib/rbac/dashboard-module-ids';

export type DashboardAccessPayload = {
  actor: DashboardActor;
  allowed_modules: DashboardModuleId[];
  hidden_modules: DashboardModuleId[];
  filter_visibility: DashboardFilterVisibility;
  permissions: UiPermissionBundle;
};

function normalizePanelRole(raw: unknown): DashboardActor['role'] | null {
  const r = String(raw ?? '').trim().toLowerCase();
  if (r === 'super_admin') return 'admin';
  if (
    r === 'admin' ||
    r === 'moderator' ||
    r === 'campaign_manager' ||
    r === 'editor' ||
    r === 'worker' ||
    r === 'user'
  ) {
    return r as DashboardActor['role'];
  }
  return null;
}

function parseFilterVisibility(raw: unknown): DashboardFilterVisibility | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    canUseGlobalFilters: Boolean(o.canUseGlobalFilters),
    showStateFilter: Boolean(o.showStateFilter),
    showPartyFilter: Boolean(o.showPartyFilter),
    showGroupFilter: Boolean(o.showGroupFilter),
    showLokSabhaFilter: Boolean(o.showLokSabhaFilter),
    showAssemblyFilter: Boolean(o.showAssemblyFilter),
    allowGlobalAllOption: Boolean(o.allowGlobalAllOption),
    active_scope: (o.active_scope as DashboardFilterVisibility['active_scope']) ?? {
      state_ids: [],
      party_ids: [],
      party_slugs: [],
      loksabha_ids: [],
      assembly_ids: [],
      group_ids: [],
    },
  };
}

/** Build client dashboard access from `/api/admin/viewer` JSON (single parser, no page-level role hacks). */
export function parseViewerDashboardAccess(
  raw: Record<string, unknown>,
  userId = 'viewer'
): DashboardAccessPayload | null {
  const role = normalizePanelRole(raw.role);
  if (!role || !['admin', 'moderator', 'campaign_manager', 'editor'].includes(role)) {
    return null;
  }

  const actor = toDashboardActor({
    role,
    assigned_state_ids: Array.isArray(raw.assigned_state_ids)
      ? (raw.assigned_state_ids as number[])
      : [],
    assigned_group_ids: Array.isArray(raw.assigned_group_ids)
      ? (raw.assigned_group_ids as string[])
      : [],
    assigned_party_ids: Array.isArray(raw.assigned_party_ids)
      ? (raw.assigned_party_ids as string[])
      : [],
    assigned_loksabha_ids: Array.isArray(raw.assigned_loksabha_ids)
      ? (raw.assigned_loksabha_ids as number[])
      : [],
    assigned_assembly_ids: Array.isArray(raw.assigned_assembly_ids)
      ? (raw.assigned_assembly_ids as number[])
      : [],
    user: { id: userId },
  });

  const da = raw.dashboard_access as Record<string, unknown> | undefined;
  const allowedFromApi = Array.isArray(da?.allowed_modules)
    ? (da!.allowed_modules as DashboardModuleId[])
    : null;
  const allowed_modules = allowedFromApi ?? getAllowedModules(actor);
  const hiddenFromApi = Array.isArray(da?.hidden_modules)
    ? (da.hidden_modules as DashboardModuleId[])
    : null;
  const hidden_modules =
    hiddenFromApi ?? ALL_DASHBOARD_MODULE_IDS.filter((m) => !allowed_modules.includes(m));

  const filterFromApi = parseFilterVisibility(da?.filter_visibility);
  const filter_visibility = filterFromApi ?? getDashboardFilterVisibility(actor);

  return {
    actor,
    allowed_modules,
    hidden_modules,
    filter_visibility,
    permissions: buildUiPermissions(actor),
  };
}
