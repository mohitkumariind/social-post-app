import { describe, expect, it } from 'vitest';
import {
  canAccessDashboardModule,
  canUseGlobalFilters,
  getBroadcastScope,
  getTwitterCampaignScope,
} from '@/lib/rbac/dashboard-access';
import {
  canCreateGroup,
  canDeleteEvent,
  canEditEvent,
  canTargetAudience,
  canUploadPost,
  canViewEvent,
  normalizeScope,
} from '@/lib/rbac/permission-engine';
import { getCachedNormalizedScope, invalidateNormalizedScopeCache, normalizedScopeCacheKey } from '@/lib/rbac/scope-cache';
import { evaluateRbacForActor } from '@/lib/rbac/rbac-debug-eval';
import { toDashboardActor } from '@/lib/rbac/dashboard-access';

const admin = {
  id: 'admin-1',
  role: 'admin' as const,
  assigned_state_ids: [] as number[],
  assigned_group_ids: [] as string[],
  assigned_party_ids: [] as string[],
};

const moderator = {
  id: 'mod-1',
  role: 'moderator' as const,
  assigned_state_ids: [10],
  assigned_group_ids: [] as string[],
  assigned_party_ids: ['bjp'],
};

const campaignManager = {
  id: 'cm-1',
  role: 'campaign_manager' as const,
  assigned_state_ids: [] as number[],
  assigned_group_ids: ['5'],
  assigned_party_ids: [] as string[],
};

const editor = {
  id: 'ed-1',
  role: 'editor' as const,
  assigned_state_ids: [10],
  assigned_group_ids: [] as string[],
  assigned_party_ids: ['bjp'],
};

const publishedModeratorEvent = {
  id: 'ev-mod',
  created_by: 'other-mod',
  created_role: 'moderator',
  status: 'published',
  state_id: [10],
  party: ['bjp'],
};

describe('RBAC production regression — events', () => {
  it('admin: full create/edit/delete and global targeting', () => {
    const own = { created_by: 'admin-1', created_role: 'admin', status: 'draft', state_id: [99] };
    const other = { created_by: 'x', created_role: 'moderator', status: 'published', state_id: [10], party: ['bjp'] };
    expect(canViewEvent(admin, other).allowed).toBe(true);
    expect(canEditEvent(admin, other).allowed).toBe(true);
    expect(canDeleteEvent(admin, other).allowed).toBe(true);
    expect(canUploadPost(admin, other).allowed).toBe(true);
    expect(canTargetAudience(admin, { state_id: [0], party_id: [] }).allowed).toBe(true);
    expect(canCreateGroup(admin).allowed).toBe(true);
    expect(canEditEvent(admin, own).allowed).toBe(true);
  });

  it('moderator: cross-role published visibility; cannot edit/delete others', () => {
    expect(canViewEvent(moderator, publishedModeratorEvent).allowed).toBe(true);
    expect(canEditEvent(moderator, publishedModeratorEvent).allowed).toBe(false);
    expect(canDeleteEvent(moderator, publishedModeratorEvent).allowed).toBe(false);
    expect(canUploadPost(moderator, publishedModeratorEvent).allowed).toBe(true);
    expect(canCreateGroup(moderator).allowed).toBe(true);
    expect(canTargetAudience(moderator, { state_id: [0] }).allowed).toBe(false);
  });

  it('campaign manager: group-scoped upload; no group create', () => {
    const inScope = {
      created_by: 'other',
      created_role: 'campaign_manager',
      status: 'published',
      target_groups: ['5'],
      state_id: [],
    };
    const outScope = { ...inScope, target_groups: ['99'] };
    expect(canEditEvent(campaignManager, inScope).allowed).toBe(false);
    expect(canUploadPost(campaignManager, inScope).allowed).toBe(true);
    expect(canUploadPost(campaignManager, outScope).allowed).toBe(false);
    expect(canCreateGroup(campaignManager).allowed).toBe(false);
  });

  it('editor: own events only for edit/delete/upload', () => {
    const own = { created_by: 'ed-1', created_role: 'editor', status: 'draft', state_id: [10] };
    const other = { created_by: 'other', created_role: 'editor', status: 'draft', state_id: [10], party: ['bjp'] };
    expect(canViewEvent(editor, own).allowed).toBe(true);
    expect(canEditEvent(editor, own).allowed).toBe(true);
    expect(canDeleteEvent(editor, own).allowed).toBe(true);
    expect(canUploadPost(editor, own).allowed).toBe(true);
    expect(canEditEvent(editor, other).allowed).toBe(false);
    expect(canDeleteEvent(editor, other).allowed).toBe(false);
    expect(canUploadPost(editor, other).allowed).toBe(false);
  });
});

describe('RBAC production regression — broadcast & twitter', () => {
  it('editor denied broadcast module', () => {
    expect(canAccessDashboardModule(editor, 'broadcast')).toBe(false);
    expect(getBroadcastScope(toDashboardActor({ ...editor, user: { id: editor.id } })).kind).toBe('denied');
  });

  it('moderator broadcast is scoped (not global)', () => {
    const scope = getBroadcastScope(toDashboardActor({ ...moderator, user: { id: moderator.id } }));
    expect(scope.kind).not.toBe('denied');
    expect(canUseGlobalFilters(toDashboardActor({ ...moderator, user: { id: moderator.id } }))).toBe(false);
  });

  it('admin twitter/global targeting allowed', () => {
    expect(canAccessDashboardModule(admin, 'twitter_campaign')).toBe(true);
    const scope = getTwitterCampaignScope(toDashboardActor({ ...admin, user: { id: admin.id } }));
    expect(scope.kind).toBe('unrestricted');
    expect(canTargetAudience(admin, { state_id: [0] }).allowed).toBe(true);
  });

  it('campaign manager twitter scoped; no global filters', () => {
    expect(canAccessDashboardModule(campaignManager, 'twitter_campaign')).toBe(true);
    expect(canUseGlobalFilters(toDashboardActor({ ...campaignManager, user: { id: campaignManager.id } }))).toBe(
      false
    );
    expect(canTargetAudience(campaignManager, { state_id: [0] }).allowed).toBe(false);
  });
});

describe('RBAC production regression — scope cache', () => {
  it('memoizes normalizeScope for identical actors', () => {
    invalidateNormalizedScopeCache();
    const a = getCachedNormalizedScope(moderator);
    const b = getCachedNormalizedScope(moderator);
    expect(a).toBe(b);
    expect(normalizedScopeCacheKey(moderator)).toContain('mod-1');
  });

  it('returns fresh scope after cache invalidation', () => {
    invalidateNormalizedScopeCache(moderator.id);
    const direct = normalizeScope(moderator);
    const cached = getCachedNormalizedScope(moderator);
    expect(cached).toEqual(direct);
  });
});

describe('RBAC debug evaluation aligns with permission-engine', () => {
  it('moderator module matrix matches engine', () => {
    const actor = toDashboardActor({ ...moderator, user: { id: moderator.id } });
    const evalResult = evaluateRbacForActor(actor);
    expect(evalResult.can_use_global_filters).toBe(false);
    expect(evalResult.allowed_modules).toContain('events');
    expect(evalResult.allowed_modules).not.toContain('parties');
    expect(evalResult.module_checks.find((m) => m.module === 'broadcast')?.allowed).toBe(true);
    expect(evalResult.module_checks.find((m) => m.module === 'dashboard')?.allowed).toBe(true);
  });
});
