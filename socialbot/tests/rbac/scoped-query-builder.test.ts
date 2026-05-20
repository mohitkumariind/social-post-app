import { describe, expect, it } from 'vitest';
import { buildScopedAnalyticsQuery, buildScopedQuery } from '@/lib/rbac/scoped-query-builder';

class FakeQuery {
  calls: Array<{ method: string; args: unknown[] }> = [];

  eq(...args: unknown[]) {
    this.calls.push({ method: 'eq', args });
    return this;
  }
  in(...args: unknown[]) {
    this.calls.push({ method: 'in', args });
    return this;
  }
  not(...args: unknown[]) {
    this.calls.push({ method: 'not', args });
    return this;
  }
  neq(...args: unknown[]) {
    this.calls.push({ method: 'neq', args });
    return this;
  }
  containedBy(...args: unknown[]) {
    this.calls.push({ method: 'containedBy', args });
    return this;
  }
  or(...args: unknown[]) {
    this.calls.push({ method: 'or', args });
    return this;
  }
}

describe('scoped query builder', () => {
  it('scopes moderator profile queries at DB layer', () => {
    const q = new FakeQuery();
    buildScopedQuery(
      {
        id: 'u1',
        role: 'moderator',
        assigned_state_ids: [1, 2],
        assigned_group_ids: [],
      },
      q,
      'profiles'
    );
    expect(q.calls.map((c) => c.method)).toEqual(['not', 'neq', 'containedBy']);
  });

  it('scopes campaign manager profiles via allowed profile IDs', () => {
    const q = new FakeQuery();
    const p1 = '11111111-1111-4111-8111-111111111111';
    const p2 = '22222222-2222-4222-8222-222222222222';
    buildScopedQuery(
      {
        id: 'u2',
        role: 'campaign_manager',
        assigned_state_ids: [],
        assigned_group_ids: ['1'],
      },
      q,
      'profiles',
      { allowed_profile_ids: [p1, p2] }
    );
    expect(q.calls[0]).toEqual({ method: 'or', args: [`id.in.(${p1},${p2}),group_id.in.(1)`] });
  });

  it('prefers effective_group_ids over profile-only ids for campaign manager events', () => {
    const q = new FakeQuery();
    buildScopedQuery(
      {
        id: 'u4',
        role: 'campaign_manager',
        assigned_state_ids: [],
        assigned_group_ids: ['1'],
      },
      q,
      'events',
      { effective_group_ids: ['1', '2', '3'] }
    );
    expect(q.calls[2]).toEqual({ method: 'containedBy', args: ['target_groups', ['1', '2', '3']] });
  });

  it('includes all-states events for moderators with assignments', () => {
    const q = new FakeQuery();
    buildScopedQuery(
      {
        id: 'mod1',
        role: 'moderator',
        assigned_state_ids: [5, 10],
        assigned_group_ids: [],
      },
      q,
      'events'
    );
    const orCall = q.calls.find((c) => c.method === 'or');
    expect(orCall?.args[0]).toContain('state_id.ov.{0}');
  });

  it('keeps analytics scoping aligned for campaign manager events', () => {
    const q = new FakeQuery();
    buildScopedAnalyticsQuery(
      {
        id: 'u3',
        role: 'campaign_manager',
        assigned_state_ids: [],
        assigned_group_ids: ['10'],
      },
      q,
      'events'
    );
    expect(q.calls.map((c) => c.method)).toEqual(['not', 'neq', 'containedBy']);
    expect(q.calls[2]).toEqual({ method: 'containedBy', args: ['target_groups', ['10']] });
  });
});
