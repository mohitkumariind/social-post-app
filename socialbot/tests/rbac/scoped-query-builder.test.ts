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
    buildScopedQuery(
      {
        id: 'u2',
        role: 'campaign_manager',
        assigned_state_ids: [],
        assigned_group_ids: ['1'],
      },
      q,
      'profiles',
      { allowed_profile_ids: ['p1', 'p2'] }
    );
    expect(q.calls).toEqual([{ method: 'in', args: ['id', ['p1', 'p2']] }]);
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
  });
});
