import { afterEach, describe, expect, it, vi } from 'vitest';

const insertMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/admin-gate', () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}));

import { auditRbacMutation, logPermissionDecision } from '@/lib/rbac/permission-audit';

describe('permission audit', () => {
  afterEach(() => {
    insertMock.mockClear();
  });

  it('writes full payload fields to rbac_audit_logs', async () => {
    logPermissionDecision({
      user_id: 'user-1',
      role: 'moderator',
      action: 'edit_event',
      resource_type: 'events',
      resource_id: 'ev-1',
      allowed: false,
      denied_reason: 'cannot_edit_others_events',
      normalized_scope: {
        state_ids: [10],
        party_ids: [],
        party_slugs: ['bjp'],
        loksabha_ids: [],
        assembly_ids: [],
        group_ids: [],
      },
      ownership_match: false,
      visibility_match: true,
      mutation_permission: false,
      metadata: { source: 'test' },
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.user_id).toBe('user-1');
    expect(row.role).toBe('moderator');
    expect(row.action).toBe('edit_event');
    expect(row.resource_type).toBe('events');
    expect(row.resource_id).toBe('ev-1');
    expect(row.allowed).toBe(false);
    expect(row.denied_reason).toBe('cannot_edit_others_events');
    expect(row.ownership_match).toBe(false);
    expect(row.visibility_match).toBe(true);
    expect(row.mutation_permission).toBe(false);
    expect(row.normalized_scope).toMatchObject({ state_ids: [10] });
    expect(row.metadata).toMatchObject({ source: 'test' });
  });

  it('auditRbacMutation logs allowed mutations', async () => {
    auditRbacMutation({
      user_id: 'admin-1',
      role: 'admin',
      mutation_action: 'events.create',
      resource_type: 'events',
      resource_id: 'ev-new',
      allowed: true,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.action).toBe('mutation.events.create');
    expect(row.allowed).toBe(true);
    expect(row.denied_reason).toBeNull();
  });
});
