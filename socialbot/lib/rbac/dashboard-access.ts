/**
 * Dashboard routing + navigation RBAC (paths, API prefixes, sidebar).
 * Module entitlements and filter visibility delegate to dashboard-permissions (permission-engine).
 */
import type { AdminAnalyticsScope } from '@/lib/admin/rbac';
import { getScopedFilters, type AdminAnalyticsUserContext } from '@/lib/admin/rbac';
import { normalizeAssignedPartyIds } from '@/lib/admin/editor-party-scope';
import { parseGroupIds, parseStateIds } from '@/lib/rbac/require';
import type { CanonicalScope } from '@/lib/rbac/scope-types';
import type { DashboardModuleId } from '@/lib/rbac/dashboard-module-ids';
import {
  canAccessDashboardModule as engineCanAccessDashboardModule,
  canUseGlobalFilters as engineCanUseGlobalFilters,
  getAllowedDashboardModules,
  getDashboardFilterVisibility as engineGetDashboardFilterVisibility,
  type DashboardActor,
  type DashboardFilterVisibility,
} from '@/lib/rbac/dashboard-permissions';

export type { DashboardModuleId } from '@/lib/rbac/dashboard-module-ids';
export type { DashboardActor, DashboardFilterVisibility } from '@/lib/rbac/dashboard-permissions';

export type DashboardSidebarItem = {
  module: DashboardModuleId;
  href: string;
  label: string;
};

export type DashboardTargetingScope =
  | { kind: 'unrestricted' }
  | {
      kind: 'state_party';
      state_ids: number[];
      party_slugs: string[];
      party_ids: number[];
    }
  | {
      kind: 'groups';
      group_ids: string[];
      profile_group_ids: number[];
      viewer_id: string;
    }
  | { kind: 'denied' };

const MODULE_PATH: Record<DashboardModuleId, string> = {
  dashboard: '/admin',
  events: '/admin/events',
  parties: '/admin/parties',
  users: '/admin/users',
  leaderboard: '/admin/leaderboard',
  analytics: '/admin/analytics',
  banner_manager: '/admin/banner-manager',
  group_management: '/admin/groups',
  broadcast: '/admin/notifications',
  twitter_campaign: '/admin/twitter-campaign',
  activity_center: '/admin/activity-center',
  rbac_observability: '/admin/rbac-observability',
  rbac_debug: '/admin/rbac-debug',
};

const SIDEBAR_LABELS: Record<DashboardModuleId, string> = {
  dashboard: 'Dashboard',
  events: 'Events',
  parties: 'Parties',
  users: 'Users',
  leaderboard: 'Leaderboard',
  analytics: 'Analytics',
  banner_manager: 'Banner Manager',
  group_management: 'Group Management',
  broadcast: 'Broadcast',
  twitter_campaign: 'Twitter Campaign',
  activity_center: 'Activity Center',
  rbac_observability: 'RBAC Observability',
  rbac_debug: 'RBAC Debug',
};

export function toDashboardActor(
  auth:
    | DashboardActor
    | (Pick<
        DashboardActor,
        | 'role'
        | 'assigned_state_ids'
        | 'assigned_group_ids'
        | 'assigned_party_ids'
        | 'assigned_loksabha_ids'
        | 'assigned_assembly_ids'
        | 'effective_group_ids'
      > & { id?: string; user?: { id: string } })
): DashboardActor {
  const id = String(
    ('user' in auth && auth.user?.id ? auth.user.id : null) ??
      ('id' in auth ? auth.id : null) ??
      ''
  ).trim();
  return {
    id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids ?? [],
    assigned_group_ids: auth.assigned_group_ids ?? [],
    assigned_party_ids: auth.assigned_party_ids ?? [],
    assigned_loksabha_ids: auth.assigned_loksabha_ids,
    assigned_assembly_ids: auth.assigned_assembly_ids,
    effective_group_ids: auth.effective_group_ids,
  };
}

export function logDashboardAccessDebug(
  action: string,
  detail: {
    role: string;
    allowed_modules?: DashboardModuleId[];
    denied_module?: DashboardModuleId | null;
    active_scope?: CanonicalScope;
    global_filter_access?: boolean;
    pathname?: string;
  }
): void {
  console.log('[dashboard-rbac]', action, detail);
}

export function getAllowedModules(actor: Pick<DashboardActor, 'role'>): DashboardModuleId[] {
  const modules = getAllowedDashboardModules(actor);
  logDashboardAccessDebug('allowed_modules', {
    role: String(actor.role),
    allowed_modules: modules,
    global_filter_access: engineCanUseGlobalFilters(actor),
  });
  return modules;
}

export function canAccessDashboardModule(
  actor: Pick<DashboardActor, 'role'>,
  moduleId: DashboardModuleId
): boolean {
  const ok = engineCanAccessDashboardModule(actor, moduleId);
  if (!ok) {
    logDashboardAccessDebug('denied_module', {
      role: String(actor.role),
      denied_module: moduleId,
      allowed_modules: getAllowedDashboardModules(actor),
      global_filter_access: engineCanUseGlobalFilters(actor),
    });
  }
  return ok;
}

export function isAdminPublicPath(pathname: string): boolean {
  const p = String(pathname ?? '').trim();
  return p === '/admin/login' || p.startsWith('/admin/login/');
}

export function pathnameToDashboardModule(pathname: string): DashboardModuleId | null {
  const p = String(pathname ?? '').trim();
  if (isAdminPublicPath(p)) return null;
  if (p === '/admin/posts' || p.startsWith('/admin/posts/')) return 'events';
  const entries = Object.entries(MODULE_PATH) as [DashboardModuleId, string][];
  const sorted = entries.sort((a, b) => b[1].length - a[1].length);
  for (const [mod, prefix] of sorted) {
    if (prefix === '/admin') {
      if (p === '/admin') return 'dashboard';
      continue;
    }
    if (p === prefix || p.startsWith(`${prefix}/`)) return mod;
  }
  return null;
}

export function canAccessDashboardPath(actor: Pick<DashboardActor, 'role'>, pathname: string): boolean {
  const p = String(pathname ?? '').trim();
  if (isAdminPublicPath(p)) return true;
  const mod = pathnameToDashboardModule(p);
  if (!mod) {
    if (p === '/admin' || p.startsWith('/admin/')) {
      logDashboardAccessDebug('denied_unknown_path', {
        role: String(actor.role),
        pathname: p,
        denied_module: null,
      });
      return false;
    }
    return false;
  }
  if (mod === 'events' && (p === '/admin/events/create' || p.startsWith('/admin/events/create/'))) {
    return actor.role === 'editor' ? false : canAccessDashboardModule(actor, 'events');
  }
  return canAccessDashboardModule(actor, mod);
}

export function getVisibleSidebarItems(actor: Pick<DashboardActor, 'role'>): DashboardSidebarItem[] {
  const allowed = new Set(getAllowedModules(actor));
  const order: DashboardModuleId[] = [
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
    'rbac_debug',
  ];
  return order
    .filter((m) => allowed.has(m))
    .map((module) => ({
      module,
      href: MODULE_PATH[module],
      label: SIDEBAR_LABELS[module],
    }));
}

export function canUseGlobalFilters(actor: Pick<DashboardActor, 'role'>): boolean {
  return engineCanUseGlobalFilters(actor);
}

export function getDashboardFilterVisibility(actor: DashboardActor): DashboardFilterVisibility {
  return engineGetDashboardFilterVisibility(actor);
}

export function getAnalyticsScope(
  actor: DashboardActor,
  ctx?: Partial<AdminAnalyticsUserContext>
): DashboardTargetingScope {
  if (!canAccessDashboardModule(actor, 'analytics')) return { kind: 'denied' };
  if (canUseGlobalFilters(actor)) return { kind: 'unrestricted' };
  const role = String(actor.role ?? '').trim().toLowerCase();
  if (role === 'moderator') {
    const states = parseStateIds(actor.assigned_state_ids);
    const partySlugs = normalizeAssignedPartyIds(actor.assigned_party_ids);
    const scope = engineGetDashboardFilterVisibility(actor).active_scope;
    return {
      kind: 'state_party',
      state_ids: states.ids,
      party_slugs: partySlugs,
      party_ids: scope.party_ids,
    };
  }
  if (role === 'campaign_manager') {
    const eff = actor.effective_group_ids ?? actor.assigned_group_ids;
    const parsed = parseGroupIds(eff);
    const profileGroupIds = parsed.ids
      .map((x) => Number(x))
      .filter((n) => Number.isSafeInteger(n) && n > 0);
    return {
      kind: 'groups',
      group_ids: [...parsed.ids],
      profile_group_ids: profileGroupIds,
      viewer_id: actor.id,
    };
  }
  return { kind: 'denied' };
}

export function getLeaderboardScope(actor: DashboardActor): DashboardTargetingScope {
  return getAnalyticsScope(actor);
}

export function getBroadcastScope(actor: DashboardActor): DashboardTargetingScope {
  if (!canAccessDashboardModule(actor, 'broadcast')) return { kind: 'denied' };
  return getAnalyticsScope(actor);
}

export function getTwitterCampaignScope(actor: DashboardActor): DashboardTargetingScope {
  if (!canAccessDashboardModule(actor, 'twitter_campaign')) return { kind: 'denied' };
  return getAnalyticsScope(actor);
}

export function toAdminAnalyticsScopeFromDashboard(
  actor: DashboardActor,
  ctx?: Partial<AdminAnalyticsUserContext>
): AdminAnalyticsScope {
  const userCtx: AdminAnalyticsUserContext = {
    id: actor.id,
    role: actor.role,
    assigned_state_ids: actor.assigned_state_ids,
    assigned_group_ids: actor.assigned_group_ids,
    effective_group_ids: actor.effective_group_ids ?? ctx?.effective_group_ids,
  };
  return getScopedFilters(userCtx);
}

export function assertAnalyticsGeoFiltersForDashboard(
  actor: DashboardActor,
  filters: { stateId: number | null; party: string | null }
): { ok: true } | { ok: false; message: string } {
  const scope = getAnalyticsScope(actor);
  if (scope.kind === 'denied') {
    return { ok: false, message: 'Forbidden: analytics not available for role' };
  }
  if (scope.kind === 'unrestricted') return { ok: true };

  if (scope.kind === 'state_party') {
    if (filters.stateId != null) {
      if (!scope.state_ids.includes(Number(filters.stateId))) {
        return { ok: false, message: 'Forbidden: state filter outside assigned states' };
      }
    }
    if (filters.party) {
      const p = String(filters.party).trim().toLowerCase();
      if (scope.party_slugs.length > 0 && !scope.party_slugs.includes(p)) {
        return { ok: false, message: 'Forbidden: party filter outside assigned parties' };
      }
    }
    return { ok: true };
  }

  if (scope.kind === 'groups') {
    if (filters.stateId != null || filters.party) {
      return { ok: false, message: 'Forbidden: state/party filters not allowed for campaign manager' };
    }
  }
  return { ok: true };
}

const EDITOR_API_RULES: { prefix: string; methods: string[] }[] = [
  { prefix: '/api/admin/viewer', methods: ['GET'] },
  { prefix: '/api/admin/events', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  { prefix: '/api/admin/posts', methods: ['GET', 'POST', 'PATCH', 'DELETE'] },
  { prefix: '/api/admin/storage/', methods: ['POST', 'DELETE'] },
];

const VIEWER_API_PATH = '/api/admin/viewer';

function isDashboardPanelRole(role: string | null | undefined): boolean {
  const r = String(role ?? '').trim().toLowerCase();
  return r === 'admin' || r === 'super_admin' || r === 'moderator' || r === 'campaign_manager' || r === 'editor';
}

export function apiPathToDashboardModule(pathname: string): DashboardModuleId | null {
  const p = String(pathname ?? '').trim();
  if (p === VIEWER_API_PATH) return null;
  if (p.startsWith('/api/admin/analytics')) return 'analytics';
  if (p.startsWith('/api/admin/leaderboard')) return 'leaderboard';
  if (p.startsWith('/api/admin/notifications') || p === '/api/notifications/send') return 'broadcast';
  if (p.startsWith('/api/admin/templates')) return 'broadcast';
  if (p.startsWith('/api/admin/twitter-campaign')) return 'twitter_campaign';
  if (p.startsWith('/api/admin/dashboard-stats')) return 'dashboard';
  if (p.startsWith('/api/admin/events')) return 'events';
  if (p.startsWith('/api/admin/posts')) return 'events';
  if (p.startsWith('/api/admin/parties')) return 'parties';
  if (p.startsWith('/api/admin/users') || p.startsWith('/api/admin/profiles')) return 'users';
  if (p.startsWith('/api/admin/profile-tags')) return 'users';
  if (p.startsWith('/api/admin/groups')) return 'group_management';
  if (p.startsWith('/api/admin/banners')) return 'banner_manager';
  if (p.startsWith('/api/admin/activity')) return 'activity_center';
  if (p.startsWith('/api/admin/rbac-observability')) return 'rbac_observability';
  if (p.startsWith('/api/admin/rbac-debug')) return 'rbac_debug';
  if (p.startsWith('/api/admin/storage/')) return 'events';
  if (p.startsWith('/api/admin/user-frames')) return 'events';
  return null;
}

export function canAccessDashboardApi(
  actor: Pick<DashboardActor, 'role'>,
  pathname: string,
  method: string
): boolean {
  const p = String(pathname ?? '').trim();
  const m = String(method ?? '').toUpperCase();

  if (p === VIEWER_API_PATH) {
    return m === 'GET' && isDashboardPanelRole(actor.role);
  }

  if (String(actor.role ?? '').trim().toLowerCase() === 'editor') {
    return EDITOR_API_RULES.some(
      (rule) => (p === rule.prefix || p.startsWith(rule.prefix)) && rule.methods.includes(m)
    );
  }

  const mod = apiPathToDashboardModule(p);
  if (!mod) {
    logDashboardAccessDebug('denied_unknown_api', {
      role: String(actor.role),
      pathname: p,
      denied_module: null,
    });
    return false;
  }
  return canAccessDashboardModule(actor, mod);
}

export { MODULE_PATH as DASHBOARD_MODULE_PATHS };
