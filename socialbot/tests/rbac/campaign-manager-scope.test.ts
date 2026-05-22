import { describe, expect, it } from 'vitest';
import { validateCampaignManagerEventPayload } from '@/lib/event-access';
import { canTargetAudience, canUploadPost } from '@/lib/rbac/permission-engine';
import { canPerformMutation } from '@/lib/rbac/mutation-gateway';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';

const cmAuth: VerifiedAdminAuth = {
  role: 'campaign_manager',
  user: { id: 'cm-1' },
  assigned_state_ids: [],
  assigned_group_ids: ['100'],
  assigned_party_ids: ['bjp'],
  assigned_loksabha_ids: [501],
  assigned_assembly_ids: [601],
};

const cmActor = {
  id: 'cm-1',
  role: 'campaign_manager' as const,
  assigned_state_ids: [] as number[],
  assigned_group_ids: ['100'],
  assigned_party_ids: ['bjp'],
  assigned_loksabha_ids: [501],
  assigned_assembly_ids: [601],
};

describe('campaign manager mutation scope', () => {
  it('allows create with target_groups in assignment', () => {
    expect(
      validateCampaignManagerEventPayload(cmAuth, {
        name: 'E',
        target_groups: ['100'],
      })
    ).toBeNull();
  });

  it('allows create with loksabha_id in assignment', () => {
    expect(
      validateCampaignManagerEventPayload(cmAuth, {
        name: 'E',
        loksabha_id: [501],
      })
    ).toBeNull();
  });

  it('denies create with state_id (state-wide)', () => {
    expect(
      validateCampaignManagerEventPayload(cmAuth, {
        name: 'E',
        state_id: [10],
        target_groups: ['100'],
      })
    ).toContain('state_id');
  });

  it('denies create without constituency anchor', () => {
    expect(validateCampaignManagerEventPayload(cmAuth, { name: 'E' })).toContain('Lok Sabha');
  });

  it('denies upload to state-only event without constituency anchor', () => {
    const event = { created_by: 'other', state_id: [10], target_groups: [] };
    const d = canUploadPost(cmActor, event);
    expect(d.allowed).toBe(false);
    expect(d.denied_reason).toBe('campaign_manager_event_missing_constituency_anchor');
  });

  it('allows upload to event with matching loksabha', () => {
    const event = { created_by: 'other', loksabha_id: [501], target_groups: [] };
    expect(canUploadPost(cmActor, event).allowed).toBe(true);
  });

  it('allows upload to event with matching target_groups', () => {
    const event = { created_by: 'other', target_groups: ['100'], state_id: [] };
    expect(canUploadPost(cmActor, event).allowed).toBe(true);
  });

  it('denies upload when loksabha outside assignment', () => {
    const event = { created_by: 'other', loksabha_id: [999], target_groups: [] };
    const d = canUploadPost(cmActor, event);
    expect(d.allowed).toBe(false);
    expect(d.denied_reason).toBe('loksabha_outside_assignment');
  });

  it('allows create with all-loksabha wildcard anchor', () => {
    expect(
      validateCampaignManagerEventPayload(cmAuth, {
        name: 'E',
        loksabha_id: [0],
      })
    ).toBeNull();
  });

  it('allows publish update for owned lok-only event without groups', () => {
    const user = {
      id: 'cm-1',
      role: 'campaign_manager' as const,
      assigned_state_ids: [] as number[],
      assigned_group_ids: [] as string[],
      assigned_party_ids: [] as string[],
      assigned_loksabha_ids: [501],
      assigned_assembly_ids: [] as number[],
    };
    const event = { created_by: 'cm-1', loksabha_id: [501], target_groups: [], name: 'E' };
    const d = canPerformMutation(
      user,
      'events.update',
      event,
      { status: 'published' },
      { resourceType: 'events', resourceId: 'e1', resourceName: 'E' }
    );
    expect(d.ok).toBe(true);
  });

  it('allows constituency wildcard targeting without global deny', () => {
    expect(canTargetAudience(cmActor, { loksabha_id: [0] }).allowed).toBe(true);
  });
});
