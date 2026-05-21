import { describe, expect, it } from 'vitest';
import { validateModeratorEventPayload } from '@/lib/rbac/moderator-scope';
import { canPerformMutation } from '@/lib/rbac/permission-mutations';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';

const modAuth: VerifiedAdminAuth = {
  role: 'moderator',
  user: { id: 'mod-1' },
  assigned_state_ids: [10, 20],
  assigned_group_ids: [],
  assigned_party_ids: ['bjp'],
  assigned_loksabha_ids: [],
  assigned_assembly_ids: [],
};

describe('moderator governance', () => {
  it('allows event with state in assignment', () => {
    expect(
      validateModeratorEventPayload(modAuth, {
        name: 'E',
        state_id: [10],
        party: ['bjp'],
      })
    ).toBeNull();
  });

  it('denies target_groups and global dashboard events', () => {
    expect(
      validateModeratorEventPayload(modAuth, {
        name: 'E',
        state_id: [10],
        target_groups: ['1'],
      })
    ).toContain('target_groups');
    expect(
      validateModeratorEventPayload(modAuth, {
        name: 'E',
        dashboard_category: 'good_morning',
        state_id: [10],
      })
    ).toContain('global dashboard');
  });

  it('denies state outside assignment', () => {
    expect(
      validateModeratorEventPayload(modAuth, {
        name: 'E',
        state_id: [99],
      })
    ).toContain('outside');
  });

  it('mutation gateway denies moderator global dashboard create', () => {
    const d = canPerformMutation(
      {
        id: 'mod-1',
        role: 'moderator',
        assigned_state_ids: [10],
        assigned_group_ids: [],
        assigned_party_ids: [],
      },
      'events.create',
      null,
      { dashboard_category: 'good_morning', state_id: [10] },
      { resourceType: 'events' }
    );
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(
        d.reason.includes('global dashboard') || d.reason.includes('global_targeting')
      ).toBe(true);
    }
  });

  it('mutation gateway allows moderator profiles.bulk_tags (route enforces scope)', () => {
    const d = canPerformMutation(
      {
        id: 'mod-1',
        role: 'moderator',
        assigned_state_ids: [10],
      },
      'profiles.bulk_tags',
      null,
      { ids: ['u1'], group_tags: ['tag'] },
      { resourceType: 'profiles' }
    );
    expect(d.ok).toBe(true);
  });

  it('mutation gateway denies moderator profiles.delete', () => {
    const d = canPerformMutation(
      {
        id: 'mod-1',
        role: 'moderator',
        assigned_state_ids: [10],
      },
      'profiles.delete',
      null,
      { id: 'u1' },
      { resourceType: 'profiles', resourceId: 'u1' }
    );
    expect(d.ok).toBe(false);
  });

  it('mutation gateway requires moderator to own group for members.add', () => {
    const d = canPerformMutation(
      {
        id: 'mod-1',
        role: 'moderator',
        assigned_state_ids: [10],
      },
      'groups.members.add',
      { created_by: 'other-mod', group_id: '5' },
      { userIds: ['u1'] },
      { resourceType: 'groups', resourceId: '5' }
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toContain('own groups');
  });
});
