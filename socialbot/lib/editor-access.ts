import type { AdminRole } from '@/lib/permissions';
import { isEditor } from '@/lib/permissions';
import { RbacError as RbacErrorClass } from '@/lib/rbac/require';

/** Admin UI paths editors may use (plus login). Create is on /admin/events (no separate nav). */
export const EDITOR_ALLOWED_ADMIN_PATH_PREFIXES = ['/admin/events'] as const;

export function isEditorAllowedAdminPath(pathname: string): boolean {
  const p = String(pathname ?? '').trim();
  if (p === '/admin/login' || p.startsWith('/admin/login/')) return true;
  if (p === '/admin/events/create' || p.startsWith('/admin/events/create/')) return false;
  return EDITOR_ALLOWED_ADMIN_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** Server routes editors may call (method-sensitive). */
export function isEditorAllowedAdminApiPath(pathname: string, method: string): boolean {
  const p = String(pathname ?? '').trim();
  const m = String(method ?? '').toUpperCase();

  if (p === '/api/admin/viewer' && m === 'GET') return true;

  if (p === '/api/admin/events' || p.startsWith('/api/admin/events?')) {
    return m === 'GET' || m === 'POST' || m === 'PATCH' || m === 'DELETE';
  }

  if (p === '/api/admin/posts' || p.startsWith('/api/admin/posts?')) {
    return m === 'GET' || m === 'POST' || m === 'PATCH' || m === 'DELETE';
  }

  if (p.startsWith('/api/admin/storage/')) {
    return m === 'POST' || m === 'DELETE';
  }

  return false;
}

export function assertNotEditor(
  auth: { role: AdminRole },
  message = 'Forbidden: editor role cannot access this resource'
): void {
  if (isEditor(auth.role)) {
    throw new RbacErrorClass(message, 403);
  }
}

/** Legacy helper: strip publish/global fields; state_id is set by validateEditorEventPayload. */
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
