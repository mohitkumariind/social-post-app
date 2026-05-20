import type { AdminRole } from '@/lib/permissions';
import { isEditor } from '@/lib/permissions';
import { RbacError as RbacErrorClass } from '@/lib/rbac/require';

/** Only path editors may use in the admin UI (plus login). */
export const EDITOR_ALLOWED_ADMIN_PATH_PREFIXES = ['/admin/events/create'] as const;

export function isEditorAllowedAdminPath(pathname: string): boolean {
  const p = String(pathname ?? '').trim();
  if (p === '/admin/login' || p.startsWith('/admin/login/')) return true;
  return EDITOR_ALLOWED_ADMIN_PATH_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** Server routes editors may call (method-sensitive checks applied at handler). */
export function isEditorAllowedAdminApiPath(pathname: string, method: string): boolean {
  const p = String(pathname ?? '').trim();
  const m = String(method ?? '').toUpperCase();
  if (p === '/api/admin/events' || p.startsWith('/api/admin/events?')) {
    return m === 'POST';
  }
  if (p === '/api/admin/viewer' && m === 'GET') return true;
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

export function applyEditorEventCreatePayload(payload: Record<string, unknown>): void {
  delete (payload as { scheduled_at?: unknown }).scheduled_at;
  delete (payload as { status?: unknown }).status;
  delete (payload as { dashboard_category?: unknown }).dashboard_category;
  delete (payload as { target_groups?: unknown }).target_groups;
  (payload as { status?: string }).status = 'draft';
  (payload as { published_at?: unknown }).published_at = null;
  (payload as { published_by?: unknown }).published_by = null;
}
