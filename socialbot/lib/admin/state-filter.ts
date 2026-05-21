import {
  canUseGlobalFilters,
  getDashboardFilterVisibility,
  toDashboardActor,
  type DashboardActor,
} from '@/lib/rbac/dashboard-access';

export type ViewerRole = DashboardActor['role'];

export type ViewerAccess = Pick<
  DashboardActor,
  'role' | 'assigned_state_ids' | 'assigned_group_ids' | 'assigned_party_ids'
>;

export type StateRow = { id: string | number; name: string };

function toIdStr(v: string | number): string {
  return String(v ?? '').trim();
}

/**
 * Centralized state visibility for admin dashboard filters (delegates to dashboard-access).
 */
export function getStateVisibility(args: {
  viewer: ViewerAccess | null;
  viewerLoading: boolean;
  allStates: StateRow[];
}): {
  visibleStates: StateRow[];
  viewerReady: boolean;
  hasSingleAssignedState: boolean;
  singleAssignedStateId: string | null;
  canUseGlobalFilters: boolean;
} {
  const { viewer, viewerLoading, allStates } = args;
  const viewerReady = !viewerLoading && !!viewer?.role;

  if (!viewerReady) {
    return {
      visibleStates: [],
      viewerReady: false,
      hasSingleAssignedState: false,
      singleAssignedStateId: null,
      canUseGlobalFilters: false,
    };
  }

  const actor = toDashboardActor({ ...viewer, user: { id: 'state-filter' } });
  const filters = getDashboardFilterVisibility(actor);
  const global = canUseGlobalFilters(actor);

  if (!filters.showStateFilter) {
    return {
      visibleStates: [],
      viewerReady: true,
      hasSingleAssignedState: false,
      singleAssignedStateId: null,
      canUseGlobalFilters: global,
    };
  }

  if (global) {
    return {
      visibleStates: allStates,
      viewerReady: true,
      hasSingleAssignedState: false,
      singleAssignedStateId: null,
      canUseGlobalFilters: true,
    };
  }

  const assigned = (viewer.assigned_state_ids ?? []).map((x) => toIdStr(x)).filter(Boolean);
  const allowed = new Set(assigned);
  const visibleStates = allStates.filter((s) => allowed.has(toIdStr(s.id)));
  const singleAssignedStateId = assigned.length === 1 ? assigned[0] : null;

  return {
    visibleStates,
    viewerReady: true,
    hasSingleAssignedState: assigned.length === 1,
    singleAssignedStateId,
    canUseGlobalFilters: false,
  };
}
