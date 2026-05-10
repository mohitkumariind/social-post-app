import { parseGroupIds, parseStateIds } from '@/lib/rbac/require';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';

/**
 * Session-derived identity for admin analytics RBAC.
 * `effective_group_ids` should be filled server-side (e.g. resolveEffectiveGroupIdsForCampaignManager)
 * before calling getScopedFilters for campaign_manager — never trust the browser.
 */
export type AdminAnalyticsUserContext = {
  id: string;
  role: string;
  assigned_state_ids: unknown;
  assigned_group_ids: unknown;
  /** Campaign manager: union of profile assignments + group_memberships (optional). */
  effective_group_ids?: unknown;
};

export type AdminAnalyticsScope =
  | { kind: 'unrestricted' }
  | {
      kind: 'moderator';
      readonly stateIds: readonly number[];
      readonly malformed: boolean;
    }
  | {
      kind: 'campaign_manager';
      readonly viewerId: string;
      /** For `profiles.group_id IN (...)`. */
      readonly profileGroupIds: readonly number[];
      /** For `events.target_groups && ...` (canonical numeric strings). */
      readonly groupIdsText: readonly string[];
      readonly malformed: boolean;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuidLiteral(id: string): string {
  const s = String(id ?? '').trim();
  if (!UUID_RE.test(s)) throw new Error('admin analytics RBAC: invalid user id for SQL literal');
  return s;
}

function uniqueSortedInts(ids: number[]): number[] {
  return Array.from(new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))).sort((a, b) => a - b);
}

/**
 * Canonical scoped filters for admin analytics SQL / Supabase server queries.
 * Call only with auth resolved from validateAdminSession + optional CM effective groups.
 */
export function getScopedFilters(user: AdminAnalyticsUserContext): AdminAnalyticsScope {
  const role = String(user.role ?? '').trim().toLowerCase();
  if (role === 'admin' || role === 'super_admin') {
    return { kind: 'unrestricted' };
  }

  if (role === 'moderator') {
    const parsed = parseStateIds(user.assigned_state_ids);
    return {
      kind: 'moderator',
      stateIds: Object.freeze(uniqueSortedInts(parsed.ids)),
      malformed: parsed.malformed,
    };
  }

  if (role === 'campaign_manager') {
    const effRaw = user.effective_group_ids ?? user.assigned_group_ids;
    const parsed = parseGroupIds(effRaw);
    const profileGroupIds = Object.freeze(
      uniqueSortedInts(parsed.ids.map((x) => Number(x)).filter((n) => Number.isSafeInteger(n) && n > 0))
    );
    const groupIdsText = Object.freeze([...parsed.ids]);
    return {
      kind: 'campaign_manager',
      viewerId: String(user.id ?? '').trim(),
      profileGroupIds,
      groupIdsText,
      malformed: parsed.malformed,
    };
  }

  /** Fail-closed for unknown roles */
  return {
    kind: 'moderator',
    stateIds: Object.freeze([]),
    malformed: true,
  };
}

export function scopeDeniesAllRows(scope: AdminAnalyticsScope): boolean {
  if (scope.kind === 'unrestricted') return false;
  if (scope.kind === 'moderator') return scope.malformed || scope.stateIds.length === 0;
  return scope.malformed || scope.profileGroupIds.length === 0 || !UUID_RE.test(scope.viewerId);
}

/**
 * Stable, non-secret fingerprint for server-side cache keys (e.g. Campaign Intelligence metrics).
 * Must change when {@link AdminAnalyticsScope} semantics change for the same role.
 */
export function adminAnalyticsScopeCacheKey(scope: AdminAnalyticsScope): string {
  if (scope.kind === 'unrestricted') return 'all';
  if (scope.kind === 'moderator') {
    return `mod:${scope.malformed ? 'x' : 'ok'}:${[...scope.stateIds].join(',')}`;
  }
  const sortedTargets = [...scope.groupIdsText].map(String).sort().join('|');
  return `cm:${scope.viewerId}:pg:${[...scope.profileGroupIds].join(',')}:tg:${sortedTargets}:${
    scope.malformed ? 'x' : 'ok'
  }`;
}

/** Map validateAdminSession output + optional CM effective groups into analytics context. */
export function toAdminAnalyticsUserContext(
  auth: VerifiedAdminAuth,
  opts?: { effective_group_ids?: string[] | null }
): AdminAnalyticsUserContext {
  return {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
    effective_group_ids: opts?.effective_group_ids ?? undefined,
  };
}

/**
 * SQL boolean expression for `profiles` rows (use in WHERE). Alias default `pr`.
 * Uses validated numeric literals only (safe for string interpolation into SQL from server).
 */
export function sqlProfilesWhere(scope: AdminAnalyticsScope, prAlias = 'pr'): string {
  if (scope.kind === 'unrestricted') return 'TRUE';
  if (scope.kind === 'moderator') {
    if (scope.malformed || scope.stateIds.length === 0) return 'FALSE';
    const arr = scope.stateIds.join(',');
    return `(${prAlias}.state_id IS NOT NULL AND ${prAlias}.state_id = ANY(ARRAY[${arr}]::bigint[]))`;
  }
  if (scope.malformed || scope.profileGroupIds.length === 0) return 'FALSE';
  const arr = scope.profileGroupIds.join(',');
  return `(${prAlias}.group_id IS NOT NULL AND ${prAlias}.group_id = ANY(ARRAY[${arr}]::bigint[]))`;
}

/**
 * SQL boolean expression for `events` rows (use in WHERE). Alias default `ev`.
 * - Moderator: event.state_id subset of assigned states (`<@` on bigint[]).
 * - Campaign manager: created_by = viewer OR target_groups overlaps assigned group ids (text[]).
 */
export function sqlEventsWhere(scope: AdminAnalyticsScope, evAlias = 'ev'): string {
  if (scope.kind === 'unrestricted') return 'TRUE';
  if (scope.kind === 'moderator') {
    if (scope.malformed || scope.stateIds.length === 0) return 'FALSE';
    const arr = scope.stateIds.join(',');
    return (
      `(${evAlias}.state_id IS NOT NULL AND cardinality(${evAlias}.state_id) > 0 ` +
      `AND ${evAlias}.state_id <@ ARRAY[${arr}]::bigint[])`
    );
  }
  const vid = assertUuidLiteral(scope.viewerId);
  if (scope.malformed || scope.groupIdsText.length === 0) return 'FALSE';
  const textArrayLiteral =
    'ARRAY[' + scope.groupIdsText.map((g) => "'" + String(g).replace(/'/g, "''") + "'").join(',') + "]::text[]";
  return (
    `(${evAlias}.created_by = '${vid}'::uuid OR (` +
    `${evAlias}.target_groups IS NOT NULL AND cardinality(${evAlias}.target_groups) > 0 ` +
    `AND ${evAlias}.target_groups && ${textArrayLiteral}))`
  );
}

/**
 * Parameterized-friendly shape for RPCs / prepared statements (avoid string SQL when possible).
 * `profilesStateAny` / `profilesGroupAny` are bigint[] for `= ANY($n)` style binds.
 */
export function getScopeSqlParams(scope: AdminAnalyticsScope):
  | { mode: 'all' }
  | { mode: 'moderator'; profilesStateAny: number[]; eventsStateSuperset: number[] }
  | {
      mode: 'campaign_manager';
      viewerId: string;
      profilesGroupAny: number[];
      eventsGroupText: string[];
    } {
  if (scope.kind === 'unrestricted') return { mode: 'all' };
  if (scope.kind === 'moderator') {
    return {
      mode: 'moderator',
      profilesStateAny: [...scope.stateIds],
      eventsStateSuperset: [...scope.stateIds],
    };
  }
  return {
    mode: 'campaign_manager',
    viewerId: scope.viewerId,
    profilesGroupAny: [...scope.profileGroupIds],
    eventsGroupText: [...scope.groupIdsText],
  };
}
