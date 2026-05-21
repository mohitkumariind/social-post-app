import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getEventVisibilityQuery,
  isEventVisibleToActor,
  publishedGlobalFeedOrClause,
  publishedStatePartyOrClause,
} from '@/lib/rbac/event-visibility-engine';

type OrCall = { filter: string };

function mockQuery(): { or: (filter: string) => OrCall; calls: OrCall[] } {
  const calls: OrCall[] = [];
  const q = {
    or(filter: string) {
      calls.push({ filter });
      return { filter };
    },
    calls,
  };
  return q;
}

describe('event-visibility-engine contract', () => {
  it('admin query is unfiltered', () => {
    const q = mockQuery();
    const out = getEventVisibilityQuery(
      { id: 'a1', role: 'admin', assigned_state_ids: [], assigned_party_ids: [] },
      q
    );
    expect(out).toBe(q);
    expect(q.calls).toHaveLength(0);
  });

  it('non-admin list OR includes owner, global feed, and state+party when states assigned', () => {
    const q = mockQuery();
    getEventVisibilityQuery(
      {
        id: 'u1',
        role: 'moderator',
        assigned_state_ids: [10],
        assigned_party_ids: ['bjp'],
      },
      q
    );
    expect(q.calls).toHaveLength(1);
    const filter = q.calls[0]!.filter;
    expect(filter).toContain('created_by.eq.u1');
    expect(filter).toContain(publishedGlobalFeedOrClause());
    const stateParty = publishedStatePartyOrClause([10], ['bjp']);
    expect(stateParty).toBeTruthy();
    expect(filter).toContain(stateParty!);
  });

  it('non-admin without assigned states omits state+party clause (owner + global only)', () => {
    const q = mockQuery();
    getEventVisibilityQuery(
      { id: 'cm1', role: 'campaign_manager', assigned_state_ids: [], assigned_party_ids: [] },
      q
    );
    const filter = q.calls[0]!.filter;
    expect(filter).toContain('created_by.eq.cm1');
    expect(filter).toContain(publishedGlobalFeedOrClause());
    expect(filter).not.toMatch(/state_id\.ov\./);
  });

  it('isEventVisibleToActor matches list clauses (owner, global, state+party)', () => {
    const actor = {
      id: 'mod-1',
      role: 'moderator' as const,
      assigned_state_ids: [10],
      assigned_party_ids: ['bjp'],
    };
    expect(
      isEventVisibleToActor(actor, {
        created_by: 'mod-1',
        status: 'draft',
        state_id: [99],
      })
    ).toBe(true);
    expect(
      isEventVisibleToActor(actor, {
        created_by: 'other',
        status: 'published',
        dashboard_category: 'good_morning',
        state_id: [],
      })
    ).toBe(true);
    expect(
      isEventVisibleToActor(actor, {
        created_by: 'other',
        status: 'published',
        state_id: [10],
        party: ['bjp'],
      })
    ).toBe(true);
    expect(
      isEventVisibleToActor(actor, {
        created_by: 'other',
        status: 'published',
        state_id: [10],
        party: ['inc'],
      })
    ).toBe(false);
  });

  it('editor with empty assigned_state_ids: own + global only (no cross-role state browse)', () => {
    const actor = {
      id: 'ed-1',
      role: 'editor' as const,
      assigned_state_ids: [] as number[],
      assigned_party_ids: [] as string[],
    };
    expect(
      isEventVisibleToActor(actor, {
        created_by: 'other',
        status: 'published',
        state_id: [10],
        party: ['bjp'],
      })
    ).toBe(false);
    expect(
      isEventVisibleToActor(actor, {
        created_by: 'other',
        status: 'published',
        dashboard_category: 'good_morning',
        state_id: [],
      })
    ).toBe(true);
  });
});

describe('events list path guard', () => {
  it('admin events route uses getEventVisibilityQuery and not deprecated list scopers', () => {
    const routePath = join(process.cwd(), 'app/api/admin/events/route.ts');
    const src = readFileSync(routePath, 'utf8');
    expect(src).toContain('getEventVisibilityQuery');
    expect(src).not.toMatch(/postFilterEventsList/);
    expect(src).not.toMatch(/applyEventsListQueryScope/);
  });
});
