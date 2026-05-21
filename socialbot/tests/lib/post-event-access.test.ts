import { describe, expect, it, vi } from 'vitest';
import { assertPostEventAccessibleForPostUpload } from '@/lib/event-access';

function mockAdmin(eventRow: Record<string, unknown> | null, err: { message: string } | null = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: eventRow, error: err }),
    update: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ error: null }),
  };
  return {
    from: vi.fn(() => chain),
    _chain: chain,
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('assertPostEventAccessibleForPostUpload', () => {
  const modAuth = {
    role: 'moderator' as const,
    user: { id: 'mod-1' } as { id: string },
    assigned_state_ids: [20],
    assigned_group_ids: [] as string[],
  };

  const cmAuth = {
    role: 'campaign_manager' as const,
    user: { id: 'cm-1' } as { id: string },
    assigned_state_ids: [] as number[],
    assigned_group_ids: ['100'],
  };

  it('allows moderator when event state is within assigned states (not owner)', async () => {
    const admin = mockAdmin({ id: 'ev-1', created_by: 'admin-9', name: 'E', state_id: [20], target_groups: [] });
    const res = await assertPostEventAccessibleForPostUpload(admin, 'ev-1', modAuth);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ownership_match).toBe(false);
      expect(res.scope_match).toBe(true);
      expect(res.access_reason).toBe('scope_upload');
    }
  });

  it('denies moderator when event state is outside assigned states', async () => {
    const admin = mockAdmin({ id: 'ev-1', created_by: 'admin-9', name: 'E', state_id: [99], target_groups: [] });
    const res = await assertPostEventAccessibleForPostUpload(admin, 'ev-1', modAuth);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('state_outside_assignment');
  });

  it('allows campaign_manager when event target_groups match assignment (not owner)', async () => {
    const admin = mockAdmin({
      id: 'ev-2',
      created_by: 'admin-9',
      name: 'E',
      state_id: [],
      target_groups: ['100'],
    });
    const res = await assertPostEventAccessibleForPostUpload(admin, 'ev-2', cmAuth);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ownership_match).toBe(false);
      expect(res.scope_match).toBe(true);
      expect(res.access_reason).toBe('scope_upload');
    }
  });

  it('denies editor when event not owned', async () => {
    const admin = mockAdmin({ id: 'ev-3', created_by: 'other', name: 'E', state_id: [20], target_groups: [] });
    const res = await assertPostEventAccessibleForPostUpload(admin, 'ev-3', {
      role: 'editor',
      user: { id: 'ed-1' },
      assigned_state_ids: [20],
      assigned_group_ids: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('editor_may_only_upload_to_own_events');
  });
});
