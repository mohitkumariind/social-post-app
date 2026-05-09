import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';

vi.mock('@/lib/audit/logAdminAction', () => ({
  logAdminAction: vi.fn(),
}));

vi.mock('@/lib/rbac/rbac-observability-engine', () => ({
  trackRbacEvent: vi.fn(),
}));

describe('unified scope engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows moderator access for in-scope state subsets', () => {
    const ok = canAccessResource(
      {
        id: 'u1',
        role: 'moderator',
        assigned_state_ids: [1, 2, 3],
        assigned_group_ids: [],
      },
      { state_ids: [1, 2] },
      { resourceType: 'events' }
    );
    expect(ok).toBe(true);
  });

  it('denies moderator access when state scope is missing (fail-closed)', () => {
    const ok = canAccessResource(
      {
        id: 'u1',
        role: 'moderator',
        assigned_state_ids: [1, 2, 3],
        assigned_group_ids: [],
      },
      { created_by: 'u1' },
      { resourceType: 'events' }
    );
    expect(ok).toBe(false);
  });

  it('allows campaign manager access only for assigned groups', () => {
    const ok = canAccessResource(
      {
        id: 'u2',
        role: 'campaign_manager',
        assigned_state_ids: [],
        assigned_group_ids: ['10', '11'],
      },
      { group_ids: ['10'] },
      { resourceType: 'profiles' }
    );
    expect(ok).toBe(true);
  });

  it('denies unknown resources by default', () => {
    const ok = canAccessResource(
      {
        id: 'u1',
        role: 'moderator',
        assigned_state_ids: [1],
        assigned_group_ids: [],
      },
      { state_ids: [1] },
      { resourceType: 'unknown_resource_type' }
    );
    expect(ok).toBe(false);
  });
});
