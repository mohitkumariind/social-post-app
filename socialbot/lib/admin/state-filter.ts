export type ViewerRole = 'admin' | 'moderator' | 'campaign_manager' | 'editor';

export type ViewerAccess = {
  role: ViewerRole;
  assigned_state_ids: number[];
};

export type StateRow = { id: string | number; name: string };

function toIdStr(v: string | number): string {
  return String(v ?? '').trim();
}

/**
 * Centralized state visibility logic for the admin dashboard.
 *
 * IMPORTANT: While viewer access is still loading/unknown, this returns an empty
 * list for `visibleStates` so moderators never briefly see "all states".
 */
export function getStateVisibility(args: {
  viewer: ViewerAccess | null;
  viewerLoading: boolean;
  allStates: StateRow[];
}): {
  visibleStates: StateRow[];
  viewerReady: boolean;
  isModerator: boolean;
  hasSingleAssignedState: boolean;
  singleAssignedStateId: string | null;
} {
  const { viewer, viewerLoading, allStates } = args;
  const viewerReady = !viewerLoading && !!viewer?.role;
  const isModerator = viewer?.role === 'moderator';
  const isCampaignManager = viewer?.role === 'campaign_manager';

  if (!viewerReady) {
    return {
      visibleStates: [],
      viewerReady: false,
      isModerator: false,
      hasSingleAssignedState: false,
      singleAssignedStateId: null,
    };
  }

  // Campaign managers never target by state in the admin UX.
  if (isCampaignManager) {
    return {
      visibleStates: [],
      viewerReady: true,
      isModerator: false,
      hasSingleAssignedState: false,
      singleAssignedStateId: null,
    };
  }

  if (!isModerator) {
    return {
      visibleStates: allStates,
      viewerReady: true,
      isModerator: false,
      hasSingleAssignedState: false,
      singleAssignedStateId: null,
    };
  }

  const assigned = (viewer?.assigned_state_ids ?? []).map((x) => toIdStr(x)).filter(Boolean);
  const allowed = new Set(assigned);
  const visibleStates = allStates.filter((s) => allowed.has(toIdStr(s.id)));
  const singleAssignedStateId = assigned.length === 1 ? assigned[0] : null;

  return {
    visibleStates,
    viewerReady: true,
    isModerator: true,
    hasSingleAssignedState: assigned.length === 1,
    singleAssignedStateId,
  };
}

