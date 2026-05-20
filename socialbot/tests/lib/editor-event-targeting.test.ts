import { describe, expect, it } from 'vitest';
import {
  finalizeEditorEventTargetingPayload,
  scopeIdsForPostFromRow,
  scopeIdsWithoutGlobalWildcard,
} from '@/lib/admin/editor-event-targeting';
import { validateEditorEventPayload } from '@/lib/event-access';
import {
  editorPartySelectionForForm,
  resolvePartySelectionsFromEvent,
} from '@/lib/admin/event-form-hydration';

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

  it('rejects global party wildcard 0 and ALL slug', () => {
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

  it('hydrates empty DB party as no selection for editor, not ALL', () => {
    expect(resolvePartySelectionsFromEvent({ party_id: [], party: [] }, [], { forEditor: true })).toEqual([]);
    expect(resolvePartySelectionsFromEvent({ party_id: [0] }, [], { forEditor: true })).toEqual([]);
    expect(resolvePartySelectionsFromEvent({ party: ['ALL'] }, [], { forEditor: true })).toEqual([]);
  });

  it('editorPartySelectionForForm strips ALL', () => {
    expect(editorPartySelectionForForm(['bjp', 'ALL'])).toEqual(['bjp']);
    expect(editorPartySelectionForForm([])).toEqual([]);
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
