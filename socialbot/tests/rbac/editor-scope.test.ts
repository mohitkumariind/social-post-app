import { describe, expect, it } from 'vitest';
import {
  eventVisibilityUserFromAuth,
  toRbacActorForEventRead,
} from '@/lib/rbac/editor-scope';
import { canViewEvent } from '@/lib/rbac/permission-engine';
import { canPerformMutation } from '@/lib/rbac/permission-mutations';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';

const editorAuth: VerifiedAdminAuth = {
  role: 'editor',
  user: { id: 'ed-1' },
  assigned_state_ids: [10],
  assigned_group_ids: [],
  assigned_party_ids: ['bjp'],
  assigned_loksabha_ids: [],
  assigned_assembly_ids: [],
};

describe('editor ownership scope', () => {
  it('zeros state/party on visibility user and read actor despite profile assignment', () => {
    const vis = eventVisibilityUserFromAuth(editorAuth);
    expect(vis.assigned_state_ids).toEqual([]);
    expect(vis.assigned_party_ids).toEqual([]);

    const readActor = toRbacActorForEventRead(editorAuth);
    expect(readActor.assigned_state_ids).toEqual([]);
    expect(readActor.assigned_party_ids).toEqual([]);
  });

  it('read actor cannot view other users published state-scoped events', () => {
    const readActor = toRbacActorForEventRead(editorAuth);
    expect(
      canViewEvent(readActor, {
        created_by: 'other',
        status: 'published',
        state_id: [10],
        party: ['bjp'],
      }).allowed
    ).toBe(false);
  });

  it('mutation gateway denies editor global dashboard and bulk tags', () => {
    const user = {
      id: 'ed-1',
      role: 'editor' as const,
      assigned_state_ids: [10],
      assigned_party_ids: [],
    };
    expect(
      canPerformMutation(user, 'events.create', null, { dashboard_category: 'good_morning' }, { resourceType: 'events' })
        .ok
    ).toBe(false);
    expect(canPerformMutation(user, 'profiles.bulk_tags', null, { ids: ['u1'] }, { resourceType: 'profiles' }).ok).toBe(
      false
    );
    expect(canPerformMutation(user, 'groups.create', null, null, { resourceType: 'groups' }).ok).toBe(false);
  });
});
