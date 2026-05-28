import { describe, expect, it } from 'vitest';
import {
  ADMIN_PANEL_ROLES,
  ADMIN_ROLE_UI_OPTIONS,
  isAdminPanelRole,
  normalizeProfileRole,
  PROFILE_ROLES,
  ROLE_OPTIONS,
} from '@/lib/profile-roles';

describe('profile-roles', () => {
  it('includes production roles and editor', () => {
    expect(PROFILE_ROLES).toContain('worker');
    expect(PROFILE_ROLES).toContain('user');
    expect(PROFILE_ROLES).toContain('admin');
    expect(PROFILE_ROLES).toContain('editor');
  });

  it('normalizes known roles', () => {
    expect(normalizeProfileRole('Editor')).toBe('editor');
    expect(normalizeProfileRole('WORKER')).toBe('worker');
    expect(normalizeProfileRole('invalid')).toBeNull();
  });

  it('admin panel roles include editor', () => {
    expect(ADMIN_PANEL_ROLES).toContain('editor');
    expect(isAdminPanelRole('editor')).toBe(true);
    expect(isAdminPanelRole('worker')).toBe(false);
    expect(isAdminPanelRole('user')).toBe(false);
  });

  it('ROLE_OPTIONS includes editor for UI', () => {
    expect(ROLE_OPTIONS.some((o) => o.value === 'editor' && o.label === 'Editor')).toBe(true);
    expect(ROLE_OPTIONS.some((o) => o.value === 'worker')).toBe(true);
  });

  it('ADMIN_ROLE_UI_OPTIONS includes user for safe downgrade', () => {
    expect(ADMIN_ROLE_UI_OPTIONS.map((o) => o.value)).toEqual([
      'user',
      'editor',
      'campaign_manager',
      'moderator',
      'admin',
    ]);
  });
});
