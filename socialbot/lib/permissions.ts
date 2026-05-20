import type { AdminPanelRole, ProfileRole } from '@/lib/profile-roles';
import { ADMIN_PANEL_ROLES, isAdminPanelRole, normalizeProfileRole } from '@/lib/profile-roles';

/** Roles returned by validateAdminSession for admin-panel users. */
export type AdminRole = AdminPanelRole;

export type { ProfileRole };

export {
  ADMIN_PANEL_ROLES,
  ADMIN_ROLE_UI_OPTIONS,
  PROFILE_ROLES,
  ROLE_OPTIONS,
  normalizeProfileRole,
  isProfileRole,
} from '@/lib/profile-roles';

/** Roles allowed to use Banner Manager (admin UI + `/api/admin/banners`). */
export const BANNER_MANAGER_ROLES: readonly AdminRole[] = ['admin', 'super_admin'];

export type ViewerAccess = {
  role: AdminRole | null;
  assigned_state_ids: number[];
};

export function isAdmin(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'admin';
}

export function isSuperAdmin(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'super_admin';
}

export function isEditor(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'editor';
}

export function isWorker(role: string | null | undefined): boolean {
  return typeof role === 'string' && role.trim().toLowerCase() === 'worker';
}

/** Roles that may POST new events (editors: draft-only; enforced in events API). */
export const EVENT_CREATE_ROLES: readonly AdminRole[] = [
  'admin',
  'super_admin',
  'moderator',
  'campaign_manager',
  'editor',
];

export function canAccessBannerManager(role: string | null | undefined): boolean {
  return isAdmin(role) || isSuperAdmin(role);
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

/** True when raw DB role may use the admin panel (editor uses restricted routes). */
export function canAccessAdminPanel(role: string | null | undefined): boolean {
  return isAdminPanelRole(role);
}
