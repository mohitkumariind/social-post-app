import { describe, expect, it } from 'vitest';
import { inheritEventScopeForPostPayload, sanitizeCampaignManagerPostScope } from '@/lib/event-access';

describe('campaign manager post scope', () => {
  it('strips state fields after inheriting event scope', () => {
    const payload: Record<string, unknown> = {
      state_id: [10],
      target_groups: [],
    };
    inheritEventScopeForPostPayload(
      { state_id: [10], target_groups: ['5'], loksabha_id: [501], assembly_id: [] },
      payload,
      'campaign_manager'
    );
    sanitizeCampaignManagerPostScope(payload);
    expect(payload.state_id).toBeUndefined();
    expect(payload.target_groups).toEqual(['5']);
    expect(payload.loksabha_id).toEqual([501]);
  });

  it('allows empty state_id key before sanitize', () => {
    const payload: Record<string, unknown> = { state_id: [], target_groups: ['5'] };
    sanitizeCampaignManagerPostScope(payload);
    expect(payload.state_id).toBeUndefined();
    expect(payload.target_groups).toEqual(['5']);
  });
});
