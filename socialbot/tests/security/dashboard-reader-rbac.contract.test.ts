/**
 * Contract tests: dashboard targeting rules must stay aligned with
 * `supabase/migrations/20260510210000_posts_events_rls_dashboard_rpc_secure.sql`
 * (`dashboard_visibility_match` + global / strict semantics).
 *
 * These do not hit the database; they guard against accidental client rule drift.
 */
import { describe, expect, it } from 'vitest';
import { explainVisibility } from '../../../utils/visibility';

const loaded = true;

function user(partial: Record<string, unknown>) {
  return {
    profile_id: 'user-1',
    party_id: 10,
    state_id: 20,
    loksabha_id: 30,
    assembly_id: 40,
    group_id: 50,
    ...partial,
  } as Record<string, unknown>;
}

describe('dashboard reader RBAC contract (client mirror of SQL)', () => {
  it('treats all-empty targeting arrays as global (visible)', () => {
    const content = {
      party_id: [],
      state_id: [],
      loksabha_id: [],
      assembly_id: [],
      group_id: [],
      profile_ids: [],
    };
    const r = explainVisibility(user({}), content, loaded);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe('global');
  });

  it('denies wrong state', () => {
    const r = explainVisibility(
      user({ state_id: 20 }),
      { party_id: [], state_id: [99], loksabha_id: [], assembly_id: [], group_id: [], profile_ids: [] },
      loaded
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('state_mismatch');
  });

  it('denies wrong party', () => {
    const r = explainVisibility(
      user({ party_id: 10 }),
      { party_id: [11], state_id: [], loksabha_id: [], assembly_id: [], group_id: [], profile_ids: [] },
      loaded
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('party_mismatch');
  });

  it('allows state 0 wildcard in targeting', () => {
    const r = explainVisibility(
      user({ state_id: 20 }),
      { party_id: [], state_id: [0], loksabha_id: [], assembly_id: [], group_id: [], profile_ids: [] },
      loaded
    );
    expect(r.ok).toBe(true);
  });

  it('requires loksabha match when targeted and no 0 wildcard', () => {
    const ok = explainVisibility(
      user({ loksabha_id: 30 }),
      { party_id: [], state_id: [], loksabha_id: [31], assembly_id: [], group_id: [], profile_ids: [] },
      loaded
    );
    expect(ok.ok).toBe(false);

    const ok2 = explainVisibility(
      user({ loksabha_id: 30 }),
      { party_id: [], state_id: [], loksabha_id: [30], assembly_id: [], group_id: [], profile_ids: [] },
      loaded
    );
    expect(ok2.ok).toBe(true);
  });

  it('requires profile_id when profile_ids targeted', () => {
    const bad = explainVisibility(
      user({ profile_id: 'user-1' }),
      {
        party_id: [],
        state_id: [],
        loksabha_id: [],
        assembly_id: [],
        group_id: [],
        profile_ids: ['other'],
      },
      loaded
    );
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('profile_id_mismatch');

    const good = explainVisibility(
      user({ profile_id: 'user-1' }),
      {
        party_id: [],
        state_id: [],
        loksabha_id: [],
        assembly_id: [],
        group_id: [],
        profile_ids: ['user-1'],
      },
      loaded
    );
    expect(good.ok).toBe(true);
  });

  it('denies when profile not loaded and user lacks usable profile', () => {
    const r = explainVisibility(
      { profile_id: '', party_id: null, state_id: null },
      { party_id: [], state_id: [], loksabha_id: [], assembly_id: [], group_id: [], profile_ids: [] },
      false
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('profile_not_loaded');
  });
});
