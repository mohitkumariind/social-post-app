/**
 * Editor-only dashboard helpers (panel routing is in dashboard-access).
 */
import type { AdminPanelRole } from '@/lib/profile-roles';
import { isEditorRole } from '@/lib/rbac/dashboard-permissions';
import { RbacError } from '@/lib/rbac/require';

export function assertNotEditor(
  auth: { role: AdminPanelRole },
  message = 'Forbidden: editor role cannot access this resource'
): void {
  if (isEditorRole(auth.role)) {
    throw new RbacError(message, 403);
  }
}

/** Strip publish/global fields; state_id is set by validateEditorEventPayload. */
export function applyEditorEventCreatePayload(payload: Record<string, unknown>): void {
  delete (payload as { scheduled_at?: unknown }).scheduled_at;
  delete (payload as { status?: unknown }).status;
  delete (payload as { dashboard_category?: unknown }).dashboard_category;
  delete (payload as { target_groups?: unknown }).target_groups;
  delete (payload as { party?: unknown }).party;
  delete (payload as { state?: unknown }).state;
  delete (payload as { party_id?: unknown }).party_id;
  delete (payload as { loksabha_id?: unknown }).loksabha_id;
  delete (payload as { assembly_id?: unknown }).assembly_id;
}
