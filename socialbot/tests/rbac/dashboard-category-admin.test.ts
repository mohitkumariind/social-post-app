import { describe, expect, it } from 'vitest';
import {
  enforceDashboardCategoryAdminOnly,
  assertNonAdminCategoryEventRowImmutable,
} from '@/lib/event-access';
import { canPerformMutation } from '@/lib/rbac/mutation-gateway';
import { getEventFormUiCapabilities } from '@/lib/rbac/dashboard-permissions';
import { RbacError } from '@/lib/rbac/require';

describe('dashboard category admin-only', () => {
  it('hides dashboard category field for non-admin event forms', () => {
    expect(
      getEventFormUiCapabilities({
        id: 'mod-1',
        role: 'moderator',
        assigned_state_ids: [10],
        assigned_group_ids: [],
        assigned_party_ids: [],
      }).showDashboardCategoryField
    ).toBe(false);
    expect(
      getEventFormUiCapabilities({
        id: 'cm-1',
        role: 'campaign_manager',
        assigned_state_ids: [],
        assigned_group_ids: ['1'],
        assigned_party_ids: [],
      }).showDashboardCategoryField
    ).toBe(false);
    expect(
      getEventFormUiCapabilities({
        id: 'ed-1',
        role: 'editor',
        assigned_state_ids: [10],
        assigned_group_ids: [],
        assigned_party_ids: [],
      }).showDashboardCategoryField
    ).toBe(false);
    expect(
      getEventFormUiCapabilities({
        id: 'admin-1',
        role: 'admin',
        assigned_state_ids: [],
        assigned_group_ids: [],
        assigned_party_ids: [],
      }).showDashboardCategoryField
    ).toBe(true);
  });

  it('rejects non-admin payload with active dashboard_category', () => {
    const payload = { dashboard_category: 'good_morning' };
    expect(() =>
      enforceDashboardCategoryAdminOnly({ role: 'moderator' }, payload)
    ).toThrow(RbacError);
    expect(payload.dashboard_category).toBe('good_morning');

    const cmPayload = { dashboard_category: 'motivation' };
    expect(() =>
      enforceDashboardCategoryAdminOnly({ role: 'campaign_manager' }, cmPayload)
    ).toThrow(/admin-only/);

    const cleared = { dashboard_category: 'none' };
    enforceDashboardCategoryAdminOnly({ role: 'editor' }, cleared);
    expect(cleared.dashboard_category).toBeNull();
  });

  it('allows admin to set dashboard_category', () => {
    const payload = { dashboard_category: 'good_morning' };
    enforceDashboardCategoryAdminOnly({ role: 'admin' }, payload);
    expect(payload.dashboard_category).toBe('good_morning');
  });

  it('blocks non-admin from patching category feed events', () => {
    expect(() =>
      assertNonAdminCategoryEventRowImmutable(
        { role: 'campaign_manager' },
        { dashboard_category: 'good_morning' }
      )
    ).toThrow(/admin-only/);
  });

  it('denies campaign_manager events.create with dashboard category via mutation gateway', () => {
    const d = canPerformMutation(
      {
        id: 'cm-1',
        role: 'campaign_manager',
        assigned_state_ids: [],
        assigned_group_ids: ['10'],
        assigned_party_ids: [],
      },
      'events.create',
      null,
      { dashboard_category: 'good_morning', name: 'E' },
      { resourceType: 'events', resourceName: 'E' }
    );
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/admin-only|global_targeting_admin_only/);
  });
});
