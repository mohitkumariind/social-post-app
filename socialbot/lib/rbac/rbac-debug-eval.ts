import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canAccessDashboardModule,
  canUseGlobalFilters,
  getAllowedModules,
  getAnalyticsScope,
  getBroadcastScope,
  getDashboardFilterVisibility,
  getLeaderboardScope,
  getTwitterCampaignScope,
  getVisibleSidebarItems,
  toDashboardActor,
  type DashboardModuleId,
} from '@/lib/rbac/dashboard-access';
import {
  canCreateGroup,
  canDeleteEvent,
  canEditEvent,
  canTargetAudience,
  canUploadPost,
  canViewEvent,
  eventVisibilityMatch,
} from '@/lib/rbac/permission-engine';
import { getCachedNormalizedScope } from '@/lib/rbac/scope-cache';
import { normalizeEventResource } from '@/lib/rbac/normalize-scope';
import type { AdminPanelRole } from '@/lib/profile-roles';

const ALL_MODULES: DashboardModuleId[] = [
  'dashboard',
  'events',
  'parties',
  'users',
  'leaderboard',
  'analytics',
  'banner_manager',
  'group_management',
  'broadcast',
  'twitter_campaign',
  'activity_center',
  'rbac_observability',
];

export type RbacDebugUserRow = {
  id: string;
  email: string | null;
  role: string;
  assigned_state_ids: number[];
  assigned_group_ids: string[];
  assigned_party_ids: string[];
};

export type RbacDebugEvaluation = {
  user: RbacDebugUserRow;
  normalized_scope: ReturnType<typeof getCachedNormalizedScope>;
  allowed_modules: DashboardModuleId[];
  denied_modules: { module: DashboardModuleId; label: string }[];
  can_use_global_filters: boolean;
  analytics_scope: ReturnType<typeof getAnalyticsScope>;
  broadcast_scope: ReturnType<typeof getBroadcastScope>;
  sample_events: {
    id: string;
    name: string;
    can_view: boolean;
    can_edit: boolean;
    can_upload: boolean;
    denied_reason?: string;
    visibility_match: boolean;
    ownership_match: boolean;
  }[];
};

export async function listDebugUsers(admin: SupabaseClient, limit = 50): Promise<RbacDebugUserRow[]> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, role, assigned_state_ids, assigned_group_ids, assigned_party_ids')
    .in('role', ['admin', 'super_admin', 'moderator', 'campaign_manager', 'editor'])
    .order('email', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String((row as { id: string }).id),
    email: (row as { email?: string | null }).email ?? null,
    role: String((row as { role?: string }).role ?? ''),
    assigned_state_ids: Array.isArray((row as { assigned_state_ids?: unknown }).assigned_state_ids)
      ? ((row as { assigned_state_ids: number[] }).assigned_state_ids)
      : [],
    assigned_group_ids: Array.isArray((row as { assigned_group_ids?: unknown }).assigned_group_ids)
      ? ((row as { assigned_group_ids: string[] }).assigned_group_ids.map(String))
      : [],
    assigned_party_ids: Array.isArray((row as { assigned_party_ids?: unknown }).assigned_party_ids)
      ? ((row as { assigned_party_ids: string[] }).assigned_party_ids.map(String))
      : [],
  }));
}

export async function evaluateRbacForUser(
  admin: SupabaseClient,
  user: RbacDebugUserRow,
  eventSampleLimit = 8
): Promise<RbacDebugEvaluation> {
  const actor = toDashboardActor({
    id: user.id,
    role: (user.role === 'super_admin' ? 'admin' : user.role) as AdminPanelRole,
    assigned_state_ids: user.assigned_state_ids,
    assigned_group_ids: user.assigned_group_ids,
    assigned_party_ids: user.assigned_party_ids,
  });

  const normalized_scope = getCachedNormalizedScope(actor);
  const allowedSet = new Set(getAllowedModules(actor));
  const denied_modules = ALL_MODULES.filter((m) => !allowedSet.has(m)).map((module) => ({
    module,
    label: module,
  }));

  const { data: events } = await admin
    .from('events')
    .select('id, name, created_by, created_role, status, published_at, state_id, party_id, party, target_groups')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(eventSampleLimit);

  const rbacActor = {
    id: actor.id,
    role: actor.role,
    assigned_state_ids: actor.assigned_state_ids,
    assigned_group_ids: actor.assigned_group_ids,
    assigned_party_ids: actor.assigned_party_ids,
  };

  const sample_events = (events ?? []).map((row) => {
    const raw = row as Record<string, unknown>;
    const view = canViewEvent(rbacActor, raw);
    const edit = canEditEvent(rbacActor, raw);
    const upload = canUploadPost(rbacActor, raw);
    const ev = normalizeEventResource(raw);
    return {
      id: String(raw.id ?? ''),
      name: String(raw.name ?? ''),
      can_view: view.allowed,
      can_edit: edit.allowed,
      can_upload: upload.allowed,
      denied_reason: view.denied_reason ?? edit.denied_reason ?? upload.denied_reason,
      visibility_match: eventVisibilityMatch(ev, normalized_scope),
      ownership_match: view.debug.ownership_match,
    };
  });

  return {
    user,
    normalized_scope,
    allowed_modules: getVisibleSidebarItems(actor).map((i) => i.module),
    denied_modules,
    can_use_global_filters: canUseGlobalFilters(actor),
    analytics_scope: getAnalyticsScope(actor),
    broadcast_scope: getBroadcastScope(actor),
    sample_events,
  };
}

export function evaluateRbacForActor(actor: ReturnType<typeof toDashboardActor>): Omit<RbacDebugEvaluation, 'user' | 'sample_events'> & {
  module_checks: { module: DashboardModuleId; allowed: boolean }[];
} {
  const normalized_scope = getCachedNormalizedScope(actor);
  return {
    normalized_scope,
    allowed_modules: getAllowedModules(actor),
    denied_modules: ALL_MODULES.filter((m) => !canAccessDashboardModule(actor, m)).map((m) => ({ module: m, label: m })),
    can_use_global_filters: canUseGlobalFilters(actor),
    analytics_scope: getAnalyticsScope(actor),
    broadcast_scope: getBroadcastScope(actor),
    module_checks: ALL_MODULES.map((module) => ({
      module,
      allowed: canAccessDashboardModule(actor, module),
    })),
  };
}
