import { describe, expect, it } from 'vitest';
import {
  buildEditorPartyTargetingFromForm,
  finalizeEditorEventTargetingPayload,
  isEditorAllPartiesUiSelection,
  scopeIdsForPostFromRow,
  scopeIdsWithoutGlobalWildcard,
} from '@/lib/admin/editor-event-targeting';
import { validateEditorEventPayload } from '@/lib/event-access';
import { resolvePartySelectionsFromEvent } from '@/lib/admin/event-form-hydration';

describe('editor event targeting', () => {
  it('empty party on create is allowed and stored as empty arrays, not ALL', () => {
    const payload: Record<string, unknown> = {
      state_id: [20],
      party_id: [],
      party: [],
    };
    const err = validateEditorEventPayload(payload, 'create', {
      assignedStateIds: [20, 21],
      assignedPartyIds: [],
    });
    expect(err).toBeNull();
    expect(payload.party_id).toEqual([]);
    expect(payload.party).toEqual([]);
    expect(payload.state_id).toEqual([20]);
  });

  it('rejects global party wildcard 0 and ALL slug in API payload', () => {
    expect(
      validateEditorEventPayload({ state_id: [20], party_id: [0] }, 'create', {
        assignedStateIds: [20],
      })
    ).toContain('all-parties');

    expect(
      validateEditorEventPayload({ state_id: [20], party: ['ALL'] }, 'create', {
        assignedStateIds: [20],
      })
    ).toContain('all-parties');
  });

  it('UI All Parties maps to state-scoped empty party arrays', () => {
    const t = buildEditorPartyTargetingFromForm(['ALL']);
    expect(t.allPartiesStateScoped).toBe(true);
    expect(t.mode).toBe('all_parties_state_scoped');
    expect(t.party_id).toEqual([]);
    expect(t.party).toEqual([]);
    expect(isEditorAllPartiesUiSelection(['ALL'])).toBe(true);
  });

  it('hydrates empty DB party as All Parties UI when state scope exists', () => {
    expect(
      resolvePartySelectionsFromEvent({ party_id: [], party: [], state_id: [20] }, [], { forEditor: true })
    ).toEqual(['ALL']);
    expect(resolvePartySelectionsFromEvent({ party_id: [], party: [] }, [], { forEditor: true })).toEqual([]);
    expect(resolvePartySelectionsFromEvent({ party_id: [0], state_id: [20] }, [], { forEditor: true })).toEqual([
      'ALL',
    ]);
  });

  it('specific parties map to slugs and ids', () => {
    const t = buildEditorPartyTargetingFromForm(['bjp', 'inc']);
    expect(t.mode).toBe('specific_parties');
    expect(t.allPartiesStateScoped).toBe(false);
    expect(t.party).toEqual(['bjp', 'inc']);
  });

  it('finalizeEditorEventTargetingPayload clears wildcard ids', () => {
    const p: Record<string, unknown> = { state_id: [20], party_id: [0, 5], party: ['all', 'bjp'] };
    finalizeEditorEventTargetingPayload(p);
    expect(p.party_id).toEqual([5]);
    expect(p.party).toEqual(['bjp']);
  });

  it('scopeIdsForPostFromRow strips wildcard 0 for posts', () => {
    expect(scopeIdsForPostFromRow({ party_id: [0] }, 'party_id')).toEqual([]);
    expect(scopeIdsForPostFromRow({ state_id: [20] }, 'state_id')).toEqual([20]);
  });

  it('scopeIdsWithoutGlobalWildcard removes zero', () => {
    expect(scopeIdsWithoutGlobalWildcard([0, 3, 0])).toEqual([3]);
  });
});
