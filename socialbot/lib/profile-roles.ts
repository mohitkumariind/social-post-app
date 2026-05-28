/**
 * Canonical profile roles (DB `profiles.role` TEXT + CHECK).
 * Production uses: worker, moderator, user, admin (+ editor).
 * Legacy/code paths may also use super_admin, campaign_manager.
 */

export const PROFILE_ROLES = [
  'worker',
  'moderator',
  'user',
  'admin',
  'editor',
  'super_admin',
  'campaign_manager',
] as const;

export type ProfileRole = (typeof PROFILE_ROLES)[number];

/** Roles that may access SocialBot admin UI / `/api/admin/*` (with editor path restrictions). */
export const ADMIN_PANEL_ROLES = [
  'admin',
  'super_admin',
  'moderator',
  'campaign_manager',
  'editor',
] as const;

export type AdminPanelRole = (typeof ADMIN_PANEL_ROLES)[number];

/** Mobile / non-admin roles — must not pass validateAdminSession. */
export const NON_ADMIN_PROFILE_ROLES = ['worker', 'user'] as const;

/** User Management dropdown (admin-assignable roles + safe downgrade to user). */
export const ADMIN_ROLE_UI_OPTIONS: { value: ProfileRole; label: string }[] = [
  { value: 'user', label: 'User' },
  { value: 'editor', label: 'Editor' },
  { value: 'campaign_manager', label: 'Campaign Manager' },
  { value: 'moderator', label: 'Moderator' },
  { value: 'admin', label: 'Admin' },
];

/** Full DB role list (assign via API / migrations). */
export const ROLE_OPTIONS: { value: ProfileRole; label: string }[] = [
  ...ADMIN_ROLE_UI_OPTIONS,
  { value: 'worker', label: 'Worker' },
  { value: 'user', label: 'User' },
  { value: 'super_admin', label: 'Super Admin' },
];

export function normalizeProfileRole(raw: unknown): ProfileRole | null {
  const r = String(raw ?? '').trim().toLowerCase();
  if (!r) return null;
  return (PROFILE_ROLES as readonly string[]).includes(r) ? (r as ProfileRole) : null;
}

export function isProfileRole(raw: unknown): raw is ProfileRole {
  return normalizeProfileRole(raw) != null;
}

export function isAdminPanelRole(raw: unknown): raw is AdminPanelRole {
  const r = normalizeProfileRole(raw);
  return r != null && (ADMIN_PANEL_ROLES as readonly string[]).includes(r);
}

export function isWorkerRole(raw: unknown): boolean {
  return normalizeProfileRole(raw) === 'worker';
}

export function isUserRole(raw: unknown): boolean {
  return normalizeProfileRole(raw) === 'user';
}

/** SQL CHECK list for migrations (single source of truth). */
export const PROFILE_ROLES_SQL_LIST = PROFILE_ROLES.map((r) => `'${r}'`).join(', ');
