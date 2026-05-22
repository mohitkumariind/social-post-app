import { describe, expect, it } from 'vitest';
import {
  canAccessScope,
  canCreateGroup,
  canDeleteEvent,
  canEditEvent,
  canTargetAudience,
  canUploadPost,
  canViewEvent,
  eventVisibilityMatch,
  normalizeScope,
} from '@/lib/rbac/permission-engine';

const modActor = {
  id: 'mod-1',
  role: 'moderator' as const,
  assigned_state_ids: [10, 20],
  assigned_group_ids: [] as string[],
  assigned_party_ids: ['bjp'],
};

const editorActor = {
  id: 'ed-1',
  role: 'editor' as const,
  assigned_state_ids: [10],
  assigned_group_ids: [] as string[],
  assigned_party_ids: [] as string[],
};

describe('permission-engine', () => {
  it('allows cross-role published visibility when state and party match', () => {
    const event = {
      created_by: 'other',
      created_role: 'moderator',
      status: 'published',
      state_id: [10],
      party: ['bjp'],
      party_id: [],
    };
    expect(canViewEvent(modActor, event).allowed).toBe(true);
    expect(eventVisibilityMatch(
      { state_ids: [10], party_ids: [], party_slugs: ['bjp'], loksabha_ids: [], assembly_ids: [], group_ids: [] },
      normalizeScope(modActor)
    )).toBe(true);
  });

  it('denies cross-role visibility when party does not match', () => {
    const event = {
      created_by: 'other',
      created_role: 'moderator',
      status: 'published',
      state_id: [10],
      party: ['inc'],
    };
    expect(canViewEvent(modActor, event).allowed).toBe(false);
  });

  it('allows editor to edit own events only', () => {
    const own = { created_by: 'ed-1', created_role: 'editor', status: 'draft', state_id: [10] };
    const other = { created_by: 'other', created_role: 'editor', status: 'draft', state_id: [10] };
    expect(canEditEvent(editorActor, own).allowed).toBe(true);
    expect(canEditEvent(editorActor, other).allowed).toBe(false);
    expect(canDeleteEvent(editorActor, other).allowed).toBe(false);
  });

  it('editor read scope: own events, global feed only (no cross-role state browse)', () => {
    const readActor = {
      ...editorActor,
      assigned_state_ids: [] as number[],
      assigned_party_ids: [] as string[],
    };
    expect(
      canViewEvent(readActor, {
        created_by: 'other',
        created_role: 'moderator',
        status: 'published',
        state_id: [10],
        party: ['bjp'],
      }).allowed
    ).toBe(false);
    expect(
      canViewEvent(readActor, {
        created_by: 'other',
        created_role: 'moderator',
        status: 'published',
        dashboard_category: 'good_morning',
        state_id: [],
        party: [],
      }).allowed
    ).toBe(true);
    expect(
      canViewEvent(readActor, {
        created_by: 'ed-1',
        status: 'draft',
        state_id: [99],
      }).allowed
    ).toBe(true);
  });

  it('denies moderator editing others events', () => {
    const event = { created_by: 'other', created_role: 'moderator', status: 'published', state_id: [10] };
    expect(canEditEvent(modActor, event).allowed).toBe(false);
  });

  it('denies global targeting for non-admin', () => {
    const t = canTargetAudience(modActor, { state_id: [0], party_id: [] });
    expect(t.allowed).toBe(false);
    expect(t.denied_reason).toBe('global_targeting_admin_only');
  });

  it('treats empty resource party as all parties within scope', () => {
    const scope = canAccessScope(modActor, { state_ids: [10], party_ids: [], party_slugs: [], loksabha_ids: [], assembly_ids: [], group_ids: [] });
    expect(scope.allowed).toBe(true);
  });

  it('allows moderator upload to in-scope non-owned event', () => {
    const event = { created_by: 'other', state_id: [10], party: [], target_groups: [] };
    expect(canUploadPost(modActor, event).allowed).toBe(true);
  });

  it('allows editor to target loksabha without profile constituency assignment', () => {
    const scope = canAccessScope(editorActor, {
      state_ids: [10],
      party_ids: [],
      party_slugs: [],
      loksabha_ids: [501],
      assembly_ids: [],
      group_ids: [],
    });
    expect(scope.allowed).toBe(true);
    expect(canTargetAudience(editorActor, { state_id: [10], loksabha_id: [501] }).allowed).toBe(true);
  });

  it('allows moderator to create groups; denies campaign_manager', () => {
    expect(canCreateGroup(modActor).allowed).toBe(true);
    expect(
      canCreateGroup({
        id: 'cm-1',
        role: 'campaign_manager',
        assigned_state_ids: [],
        assigned_group_ids: ['1'],
        assigned_party_ids: [],
      }).allowed
    ).toBe(false);
  });
});
