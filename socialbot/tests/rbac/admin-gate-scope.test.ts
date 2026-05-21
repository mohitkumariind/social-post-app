import { describe, expect, it } from 'vitest';
import { toRbacActor, toRbacUser, toVerifiedAdminAuth } from '@/lib/admin-gate';

describe('admin-gate scope plumbing', () => {
  it('propagates constituency fields through toRbacActor and toRbacUser', () => {
    const session = {
      ok: true as const,
      user: { id: 'cm-uuid' },
      role: 'campaign_manager' as const,
      assigned_state_ids: [] as number[],
      assigned_group_ids: ['g1'],
      assigned_party_ids: ['bjp'],
      assigned_loksabha_ids: [101, 102],
      assigned_assembly_ids: [201],
    };

    const auth = toVerifiedAdminAuth(session);
    expect(auth.assigned_loksabha_ids).toEqual([101, 102]);
    expect(auth.assigned_assembly_ids).toEqual([201]);

    const actor = toRbacActor(auth);
    expect(actor.assigned_loksabha_ids).toEqual([101, 102]);
    expect(actor.assigned_assembly_ids).toEqual([201]);
    expect(actor.assigned_group_ids).toEqual(['g1']);

    const user = toRbacUser(auth);
    expect(user.assigned_loksabha_ids).toEqual([101, 102]);
    expect(user.assigned_assembly_ids).toEqual([201]);
  });
});
