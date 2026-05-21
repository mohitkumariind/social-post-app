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

  it('editor uses unified visibility: state+party published or global dashboard feed', () => {
    const otherPublished = {
      created_by: 'other',
      created_role: 'moderator',
      status: 'published',
      state_id: [10],
      party: ['bjp'],
    };
    expect(canViewEvent(editorActor, otherPublished).allowed).toBe(true);
    expect(
      canViewEvent(editorActor, {
        created_by: 'other',
        created_role: 'moderator',
        status: 'published',
        dashboard_category: 'good_morning',
        state_id: [],
        party: [],
      }).allowed
    ).toBe(true);
    expect(
      canViewEvent(editorActor, {
        created_by: 'other',
        created_role: 'moderator',
        status: 'published',
        state_id: [99],
        party: ['bjp'],
      }).allowed
    ).toBe(false);
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
