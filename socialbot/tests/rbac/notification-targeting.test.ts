import { describe, expect, it } from 'vitest';
import { RbacError } from '@/lib/rbac/require';
import { applyCanonicalNotificationTargeting } from '@/lib/rbac/notification-targeting';

describe('notification targeting canonicalization', () => {
  it('forces moderator payload to assigned states', () => {
    const payload = applyCanonicalNotificationTargeting(
      {
        user: { id: 'u1' },
        role: 'moderator',
        assigned_state_ids: [11, 12],
        assigned_group_ids: [],
      },
      { title: 't', body: 'b', all_workers: true },
      'notifications.scope.validate'
    );

    expect(payload.all_workers).toBe(false);
    expect((payload.filters as any)?.assigned_state_ids).toEqual([11, 12]);
  });

  it('canonicalizes campaign manager group IDs', () => {
    const payload = applyCanonicalNotificationTargeting(
      {
        user: { id: 'u2' },
        role: 'campaign_manager',
        assigned_state_ids: [],
        assigned_group_ids: ['01', '2'],
      },
      { title: 't', body: 'b' },
      'notifications.schedule.scope.validate'
    );

    expect((payload.filters as any)?.group_ids).toEqual([1, 2]);
    expect(payload.all_workers).toBe(false);
  });

  it('denies malformed campaign manager assignments', () => {
    expect(() =>
      applyCanonicalNotificationTargeting(
        {
          user: { id: 'u3' },
          role: 'campaign_manager',
          assigned_state_ids: [],
          assigned_group_ids: ['abc'],
        },
        { title: 't', body: 'b' },
        'notifications.scope.validate'
      )
    ).toThrow(RbacError);
  });
});
