import { canAccessDashboardApi, canAccessDashboardPath } from '@/lib/rbac/dashboard-access';

export { assertNotEditor, applyEditorEventCreatePayload } from '@/lib/rbac/editor-panel';

/** @deprecated Use {@link canAccessDashboardPath} from dashboard-access. */
export const EDITOR_ALLOWED_ADMIN_PATH_PREFIXES = ['/admin/events'] as const;

export function isEditorAllowedAdminPath(pathname: string): boolean {
  return canAccessDashboardPath({ role: 'editor', assigned_state_ids: [], assigned_group_ids: [], assigned_party_ids: [], id: '' }, pathname);
}

export function isEditorAllowedAdminApiPath(pathname: string, method: string): boolean {
  return canAccessDashboardApi({ role: 'editor', assigned_state_ids: [], assigned_group_ids: [], assigned_party_ids: [], id: '' }, pathname, method);
}
