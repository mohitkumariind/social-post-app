import type { UiPermissionBundle } from '@/lib/rbac/ui-capabilities';
import { eventRowForPermissions } from '@/lib/admin/event-permission-row';

export type EventRowPermissions = {
  canEdit: boolean;
  canDelete: boolean;
  canUpload: boolean;
  canView: boolean;
};

/** Batch permission map for event lists — avoids per-render repeated engine calls in loops. */
export function buildEventPermissionMap(
  events: Array<{
    id: string | number;
    created_by?: string | null;
    created_role?: string | null;
    status?: string | null;
    party?: string[] | string | null;
    state?: string[] | string | null;
    state_id?: number[];
    target_groups?: string[] | string | null;
    dashboard_category?: string | null;
  }>,
  permissions: Pick<UiPermissionBundle, 'canViewEvent' | 'canEditEvent' | 'canDeleteEvent' | 'canUploadPost'> | null | undefined
): Map<string, EventRowPermissions> {
  const map = new Map<string, EventRowPermissions>();
  if (!permissions) return map;
  for (const ev of events) {
    const id = String(ev.id ?? '').trim();
    if (!id) continue;
    const row = eventRowForPermissions(ev);
    map.set(id, {
      canView: permissions.canViewEvent(row),
      canEdit: permissions.canEditEvent(row),
      canDelete: permissions.canDeleteEvent(row),
      canUpload: permissions.canUploadPost(row),
    });
  }
  return map;
}
