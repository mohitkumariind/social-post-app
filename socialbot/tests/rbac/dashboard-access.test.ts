import { describe, expect, it } from 'vitest';
import {
  apiPathToDashboardModule,
  canAccessDashboardApi,
  canAccessDashboardModule,
  canAccessDashboardPath,
  canUseGlobalFilters,
  getAllowedModules,
  getVisibleSidebarItems,
} from '@/lib/rbac/dashboard-access';

const mod = {
  id: 'm1',
  role: 'moderator' as const,
  assigned_state_ids: [1],
  assigned_group_ids: [] as string[],
  assigned_party_ids: ['bjp'],
};

const cm = {
  id: 'c1',
  role: 'campaign_manager' as const,
  assigned_state_ids: [] as number[],
  assigned_group_ids: ['10'],
  assigned_party_ids: [] as string[],
};

describe('dashboard-access', () => {
  it('admin sees all modules and global filters', () => {
    const admin = { ...mod, role: 'admin' as const };
    expect(getAllowedModules(admin)).toContain('rbac_observability');
    expect(canUseGlobalFilters(admin)).toBe(true);
    expect(canAccessDashboardPath(admin, '/admin/parties')).toBe(true);
  });

  it('moderator cannot access parties or banner manager', () => {
    expect(canAccessDashboardModule(mod, 'parties')).toBe(false);
    expect(canAccessDashboardModule(mod, 'twitter_campaign')).toBe(true);
    expect(canUseGlobalFilters(mod)).toBe(false);
  });

  it('campaign manager has no dashboard home but has twitter campaign', () => {
    expect(canAccessDashboardModule(cm, 'dashboard')).toBe(false);
    expect(canAccessDashboardModule(cm, 'twitter_campaign')).toBe(true);
    expect(canAccessDashboardPath(cm, '/admin')).toBe(false);
    expect(canAccessDashboardPath(cm, '/admin/events')).toBe(true);
  });

  it('editor only sees events in sidebar', () => {
    const ed = { ...mod, role: 'editor' as const };
    const items = getVisibleSidebarItems(ed);
    expect(items).toHaveLength(1);
    expect(items[0]?.module).toBe('events');
  });

  it('fail-closed: unknown admin path denied', () => {
    const admin = { ...mod, role: 'admin' as const };
    expect(canAccessDashboardPath(admin, '/admin/unknown-module')).toBe(false);
    expect(canAccessDashboardPath(mod, '/admin/secret')).toBe(false);
  });

  it('/admin/posts maps to events module', () => {
    const ed = { ...mod, role: 'editor' as const };
    expect(canAccessDashboardPath(ed, '/admin/posts')).toBe(true);
    expect(canAccessDashboardPath(cm, '/admin/posts')).toBe(true);
    expect(canAccessDashboardPath(mod, '/admin/parties')).toBe(false);
  });

  it('fail-closed: unknown admin API denied for non-editor', () => {
    const admin = { ...mod, role: 'admin' as const };
    expect(canAccessDashboardApi(admin, '/api/admin/unknown-endpoint', 'GET')).toBe(false);
    expect(canAccessDashboardApi(mod, '/api/admin/templates', 'GET')).toBe(true);
    expect(canAccessDashboardApi(mod, '/api/admin/parties', 'GET')).toBe(false);
  });

  it('viewer API allowed for panel roles; templates denied for editor', () => {
    const ed = { ...mod, role: 'editor' as const };
    expect(canAccessDashboardApi(ed, '/api/admin/viewer', 'GET')).toBe(true);
    expect(canAccessDashboardApi(ed, '/api/admin/templates', 'GET')).toBe(false);
    expect(apiPathToDashboardModule('/api/admin/user-frames')).toBe('events');
    expect(apiPathToDashboardModule('/api/admin/rbac-debug')).toBe('rbac_debug');
    expect(apiPathToDashboardModule('/api/admin/not-registered')).toBeNull();
  });
});
