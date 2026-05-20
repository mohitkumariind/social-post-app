import { describe, expect, it } from 'vitest';
import { isEditorAllowedAdminApiPath, isEditorAllowedAdminPath } from '@/lib/editor-access';

describe('editor-access', () => {
  it('allows events page and login only (no separate create nav)', () => {
    expect(isEditorAllowedAdminPath('/admin/events')).toBe(true);
    expect(isEditorAllowedAdminPath('/admin/events/create')).toBe(false);
    expect(isEditorAllowedAdminPath('/admin/login')).toBe(true);
    expect(isEditorAllowedAdminPath('/admin/notifications')).toBe(false);
  });

  it('allows GET/PATCH/DELETE events and POST/PATCH posts', () => {
    expect(isEditorAllowedAdminApiPath('/api/admin/events', 'GET')).toBe(true);
    expect(isEditorAllowedAdminApiPath('/api/admin/events', 'POST')).toBe(true);
    expect(isEditorAllowedAdminApiPath('/api/admin/events', 'PATCH')).toBe(true);
    expect(isEditorAllowedAdminApiPath('/api/admin/events', 'DELETE')).toBe(true);
    expect(isEditorAllowedAdminApiPath('/api/admin/events?id=1', 'GET')).toBe(true);
    expect(isEditorAllowedAdminApiPath('/api/admin/posts', 'POST')).toBe(true);
    expect(isEditorAllowedAdminApiPath('/api/admin/viewer', 'GET')).toBe(true);
    expect(isEditorAllowedAdminApiPath('/api/admin/banners', 'GET')).toBe(false);
  });
});
