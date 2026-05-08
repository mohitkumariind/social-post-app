export type AdminRole = 'admin' | 'moderator';

export type ViewerAccess = {
  role: AdminRole | null;
  assigned_state_id: number | null;
};

export function isAdmin(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'admin';
}

export function isModerator(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'moderator';
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
  if (viewer.assigned_state_id == null) return false;
  if (stateId == null) return false;
  return Number(viewer.assigned_state_id) === Number(stateId);
}

