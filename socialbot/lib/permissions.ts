export type AdminRole = 'admin' | 'moderator' | 'campaign_manager';

export type ViewerAccess = {
  role: AdminRole | null;
  assigned_state_ids: number[];
};

export function isAdmin(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'admin';
}

export function isModerator(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'moderator';
}

export function isCampaignManager(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'campaign_manager';
}

/**
 * Moderators can only access their own assigned state.
 * Admins are unrestricted.
 */
export function canAccessState(
  viewer: ViewerAccess,
  stateId: number | null | undefined
): boolean {
  if (isAdmin(viewer.role)) return true;
  if (!isModerator(viewer.role)) return false;
  if (!Array.isArray(viewer.assigned_state_ids) || viewer.assigned_state_ids.length === 0) return false;
  if (stateId == null) return false;
  return viewer.assigned_state_ids.some((x) => Number(x) === Number(stateId));
}

