/**
 * Ensures mobile content visibility (content-visibility.ts / dashboard_visibility_match)
 * stays aligned with admin event visibility (permission-engine eventVisibilityMatch)
 * for the same state/party profile dimensions.
 */
import { describe, expect, it } from 'vitest';
import { contentTargetingMatch } from '../../../lib/rbac/content-visibility';
import {
  canViewEvent,
  eventVisibilityMatch,
  normalizeScope,
} from '@/lib/rbac/permission-engine';
import { normalizeEventResource } from '@/lib/rbac/normalize-scope';

const modActor = {
  id: 'mod-1',
  role: 'moderator' as const,
  assigned_state_ids: [10],
  assigned_group_ids: [] as string[],
  assigned_party_ids: ['bjp'],
};

/** Map slug party to numeric id for mobile SQL-style checks (test fixture). */
const PARTY_ID_BY_SLUG: Record<string, number> = { bjp: 1, inc: 2 };

function profileForActor(actor: typeof modActor) {
  const stateId = actor.assigned_state_ids[0] ?? null;
  const partySlug = actor.assigned_party_ids[0] ?? '';
  return {
    profile_id: actor.id,
    state_id: stateId,
    party_id: PARTY_ID_BY_SLUG[partySlug] ?? null,
  };
}

function eventRow(stateId: number, partySlug: string) {
  return {
    created_by: 'other',
    created_role: 'moderator',
    status: 'published',
    state_id: [stateId],
    party: [partySlug],
    party_id: [],
  };
}

function contentFromEvent(stateId: number, partySlug: string) {
  const partyNum = PARTY_ID_BY_SLUG[partySlug];
  return {
    state_id: [stateId],
    party_id: partyNum != null ? [partyNum] : [],
    loksabha_id: [],
    assembly_id: [],
    group_id: [],
    profile_ids: [],
  };
}

function assertParity(stateId: number, partySlug: string, expectVisible: boolean) {
  const event = eventRow(stateId, partySlug);
  const adminVisible = canViewEvent(modActor, event).allowed;
  const ev = normalizeEventResource(event);
  const engineMatch = eventVisibilityMatch(ev, normalizeScope(modActor));
  const mobile = contentTargetingMatch(profileForActor(modActor), contentFromEvent(stateId, partySlug));

  expect(adminVisible).toBe(expectVisible);
  expect(engineMatch).toBe(expectVisible);
  expect(mobile.ok).toBe(expectVisible);
}

describe('mobile vs admin visibility parity', () => {
  it('same state + same party → visible', () => {
    assertParity(10, 'bjp', true);
  });

  it('same state + different party → denied', () => {
    assertParity(10, 'inc', false);
  });

  it('different state + same party → denied', () => {
    assertParity(20, 'bjp', false);
  });

  it('different state + different party → denied', () => {
    assertParity(20, 'inc', false);
  });

  it('empty event party = all parties within state (admin); mobile empty party_id = all', () => {
    const event = { ...eventRow(10, 'bjp'), party: [] as string[] };
    expect(canViewEvent(modActor, event).allowed).toBe(true);
    const mobile = contentTargetingMatch(profileForActor(modActor), {
      state_id: [10],
      party_id: [],
      loksabha_id: [],
      assembly_id: [],
      group_id: [],
      profile_ids: [],
    });
    expect(mobile.ok).toBe(true);
  });
});
