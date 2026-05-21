import { describe, expect, it } from 'vitest';
import { resolveEditorGeoIdsForPayload } from '@/lib/admin/event-form-hydration';
import { getDashboardFilterVisibility, getEventFormUiCapabilities } from '@/lib/rbac/dashboard-permissions';
import { parseViewerDashboardAccess } from '@/lib/rbac/parse-viewer-access';
import { rbacScopeMetadata } from '@/lib/rbac/scope-observability';

describe('dashboard phase 5', () => {
  it('campaign manager sees constituency filters and geo targeting on event form', () => {
    const actor = {
      id: 'cm-1',
      role: 'campaign_manager' as const,
      assigned_state_ids: [],
      assigned_group_ids: ['10'],
      assigned_party_ids: [],
      assigned_loksabha_ids: [501],
      assigned_assembly_ids: [601],
    };
    const fv = getDashboardFilterVisibility(actor);
    expect(fv.showGroupFilter).toBe(true);
    expect(fv.showLokSabhaFilter).toBe(true);
    expect(fv.showAssemblyFilter).toBe(true);
    const caps = getEventFormUiCapabilities(actor);
    expect(caps.campaignManagerForm).toBe(true);
    expect(caps.showGeoTargeting).toBe(true);
    expect(caps.showGroupTargeting).toBe(true);
    expect(caps.canUseGlobalTargeting).toBe(false);
  });

  it('editor form hides global targeting', () => {
    const caps = getEventFormUiCapabilities({
      id: 'ed-1',
      role: 'editor',
      assigned_state_ids: [10],
      assigned_group_ids: [],
      assigned_party_ids: [],
    });
    expect(caps.editorForm).toBe(true);
    expect(caps.canUseGlobalTargeting).toBe(false);
    expect(caps.showGroupTargeting).toBe(false);
    expect(caps.showAllAssignedGeoOption).toBe(true);
  });

  it('parseViewerDashboardAccess binds real user_id to actor', () => {
    const access = parseViewerDashboardAccess({
      user_id: 'editor-uuid-99',
      role: 'editor',
      assigned_state_ids: [10],
      assigned_group_ids: [],
      assigned_party_ids: [],
    });
    expect(access?.actor.id).toBe('editor-uuid-99');
  });

  it('resolveEditorGeoIdsForPayload expands ALL to assigned ids', () => {
    expect(resolveEditorGeoIdsForPayload(['ALL'], ['501', '502'])).toEqual([501, 502]);
    expect(resolveEditorGeoIdsForPayload(['501'], ['501', '502'])).toEqual([501]);
  });

  it('scope metadata includes lok sabha and assembly ids', () => {
    const meta = rbacScopeMetadata({
      assigned_state_ids: [],
      assigned_group_ids: ['1'],
      assigned_party_ids: ['bjp'],
      assigned_loksabha_ids: [501, 502],
      assigned_assembly_ids: [601],
    });
    expect(meta.scope_loksabha_ids).toEqual([501, 502]);
    expect(meta.scope_assembly_ids).toEqual([601]);
  });
});
