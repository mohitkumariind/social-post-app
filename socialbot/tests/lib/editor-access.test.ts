import { describe, expect, it } from 'vitest';
import {
  applyEditorEventCreatePayload,
  isEditorAllowedAdminApiPath,
  isEditorAllowedAdminPath,
} from '@/lib/editor-access';

describe('editor-access', () => {
  it('allows only create page and login', () => {
    expect(isEditorAllowedAdminPath('/admin/events/create')).toBe(true);
    expect(isEditorAllowedAdminPath('/admin/login')).toBe(true);
    expect(isEditorAllowedAdminPath('/admin/notifications')).toBe(false);
    expect(isEditorAllowedAdminPath('/admin/events')).toBe(false);
  });

  it('allows POST events and GET viewer only', () => {
    expect(isEditorAllowedAdminApiPath('/api/admin/events', 'POST')).toBe(true);
    expect(isEditorAllowedAdminApiPath('/api/admin/events?id=1', 'GET')).toBe(false);
    expect(isEditorAllowedAdminApiPath('/api/admin/events', 'PATCH')).toBe(false);
    expect(isEditorAllowedAdminApiPath('/api/admin/viewer', 'GET')).toBe(true);
    expect(isEditorAllowedAdminApiPath('/api/admin/banners', 'GET')).toBe(false);
  });

  it('forces draft-only create payload', () => {
    const payload: Record<string, unknown> = {
      status: 'published',
      scheduled_at: '2099-01-01T00:00:00.000Z',
      dashboard_category: 'good_morning',
      target_groups: ['g1'],
    };
    applyEditorEventCreatePayload(payload);
    expect(payload.status).toBe('draft');
    expect(payload.scheduled_at).toBeUndefined();
    expect(payload.dashboard_category).toBeUndefined();
    expect(payload.target_groups).toBeUndefined();
    expect(payload.published_at).toBeNull();
    expect(payload.published_by).toBeNull();
  });
});
