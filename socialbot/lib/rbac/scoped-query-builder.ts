import type { SupabaseClient } from '@supabase/supabase-js';
import { isAdminRole } from '@/lib/rbac/dashboard-permissions';
import { getEventVisibilityQuery } from '@/lib/rbac/event-visibility-engine';
import { parseGroupIds, parseStateIds } from '@/lib/rbac/require';
import type { UnifiedUser } from '@/lib/rbac/unified-scope-engine';
import {
  auditUnsupportedResourceUsage,
  validateRegisteredResourceForLayer,
} from '@/lib/rbac/resource-classification';

export type ScopedResourceType =
  | 'events'
  | 'groups'
  | 'profiles'
  | 'posts'
  | 'notification_templates'
  | 'admin_logs';

type AnyQuery = any;
type CanonicalScope = { stateIds: number[]; groupIds: string[]; malformed: boolean };

function canonicalScopeFromUser(user: Pick<UnifiedUser, 'assigned_state_ids' | 'assigned_group_ids'>): CanonicalScope {
  const states = parseStateIds(user.assigned_state_ids);
  const groups = parseGroupIds(user.assigned_group_ids);
  return { stateIds: states.ids, groupIds: groups.ids, malformed: states.malformed || groups.malformed };
}

function toGroupIdNums(groupIds: string[]): number[] {
  return groupIds.map((x) => Number(x)).filter((n) => Number.isSafeInteger(n) && n > 0);
}

function toUuidList(ids: string[]): string[] {
  // Keep conservative to avoid malformed PostgREST filter strings.
  return ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
}

export type ScopedQueryContext = {
  /**
   * Optional precomputed IDs for scoping when a direct DB predicate isn't possible
   * (e.g. profiles visible via group_memberships).
   */
  allowed_profile_ids?: string[];
  /**
   * Union of `profiles.assigned_group_ids` and `group_memberships.group_id` rows for this user.
   * When set, campaign_manager DB filters use this instead of JWT/profile-only `assigned_group_ids`
   * so listings match mixed assignment models.
   */
  effective_group_ids?: string[];
};

function campaignManagerScopeGroupIds(canonical: CanonicalScope, ctx: ScopedQueryContext): string[] {
  if (Array.isArray(ctx.effective_group_ids) && ctx.effective_group_ids.length > 0) return ctx.effective_group_ids;
  return canonical.groupIds;
}

function scopeEventsQuery(user: UnifiedUser, baseQuery: AnyQuery): AnyQuery {
  return getEventVisibilityQuery(user, baseQuery);
}

/**
 * Applies RBAC scoping at the DB query layer.
 * List predicates mirror permission-engine semantics (canViewEvent / canAccessScope subset rules).
 * Row-level UI mutations still require canEditEvent / canPerformMutation.
 */
export function buildScopedQuery(
  user: UnifiedUser,
  baseQuery: AnyQuery,
  resourceType: ScopedResourceType,
  ctx: ScopedQueryContext = {}
): AnyQuery {
  const resourceValidation = validateRegisteredResourceForLayer(resourceType, 'query');
  if (!resourceValidation.ok) {
    auditUnsupportedResourceUsage({
      user,
      resourceType,
      layer: 'query',
      reason: resourceValidation.reason,
      action: 'rbac.query.resource_validation',
    });
    return baseQuery.eq('id', '__none__');
  }

  if (isAdminRole(user.role)) return baseQuery;

  const role = user.role;
  const canonical = canonicalScopeFromUser(user);
  if (canonical.malformed) return baseQuery.eq('id', '__none__');

  if (resourceType === 'events') {
    return scopeEventsQuery(user, baseQuery);
  }

  if (resourceType === 'posts') {
    return baseQuery.eq('created_by', String(user.id ?? '').trim());
  }

  if (resourceType === 'notification_templates') {
    // Ownership-only resources
    return baseQuery.eq('created_by', user.id);
  }

  if (resourceType === 'groups') {
    if (role === 'moderator') return baseQuery.eq('created_by', user.id);
    const gids = toGroupIdNums(canonical.groupIds);
    return gids.length > 0 ? baseQuery.in('id', gids) : baseQuery.eq('id', -1);
  }

  if (resourceType === 'profiles') {
    if (role === 'moderator') {
      // Require profile.assigned_state_ids subset of moderator assigned_state_ids.
      return baseQuery.not('assigned_state_ids', 'is', null).neq('assigned_state_ids', '{}').containedBy('assigned_state_ids', canonical.stateIds);
    }
    // campaign_manager: support mixed deployments where some data uses group_memberships while some still uses profiles.group_id.
    const allowedRaw = Array.isArray(ctx.allowed_profile_ids) ? ctx.allowed_profile_ids.map((x) => String(x).trim()).filter(Boolean) : [];
    const allowed = toUuidList(allowedRaw);
    const scopeGids = campaignManagerScopeGroupIds(canonical, ctx);
    const gids = toGroupIdNums(scopeGids);
    if (allowed.length > 0 && gids.length > 0) {
      // Include campaign managers assigned to these groups even if they aren't members and have no profiles.group_id.
      // `profiles.assigned_group_ids` is stored as an array of numeric strings in canonical schema.
      const ov = scopeGids.length > 0 ? `,assigned_group_ids.ov.{${scopeGids.join(',')}}` : '';
      return baseQuery.or(`id.in.(${allowed.join(',')}),group_id.in.(${gids.join(',')})${ov}`);
    }
    if (allowed.length > 0) return baseQuery.in('id', allowed);
    return gids.length > 0 ? baseQuery.in('group_id', gids) : baseQuery.eq('id', '__none__');
  }

  if (resourceType === 'admin_logs') {
    if (role === 'campaign_manager') {
      const scopeGids = campaignManagerScopeGroupIds(canonical, ctx);
      if (scopeGids.length === 0) return baseQuery.eq('id', '__none__');
      return baseQuery.not('scope_group_ids', 'is', null).neq('scope_group_ids', '{}').containedBy('scope_group_ids', scopeGids);
    }
    // moderator: require scope_state_ids subset of assigned states.
    const sids = canonical.stateIds;
    if (sids.length === 0) return baseQuery.eq('id', '__none__');
    return baseQuery.not('scope_state_ids', 'is', null).neq('scope_state_ids', '{}').containedBy('scope_state_ids', sids);
  }

  // Fail closed for unknown resource types to avoid accidental data exposure.
  return baseQuery.eq('id', '__none__');
}

/**
 * Analytics scoping mirrors buildScopedQuery semantics so counts can never be weaker than read/mutation RBAC.
 * This prevents subset-vs-overlap drift and count leakage.
 */
export function buildScopedAnalyticsQuery(
  user: UnifiedUser,
  baseQuery: AnyQuery,
  resourceType: Extract<ScopedResourceType, 'events' | 'profiles' | 'posts'>,
  ctx: ScopedQueryContext = {}
): AnyQuery {
  const resourceValidation = validateRegisteredResourceForLayer(resourceType, 'analytics');
  if (!resourceValidation.ok) {
    auditUnsupportedResourceUsage({
      user,
      resourceType,
      layer: 'analytics',
      reason: resourceValidation.reason,
      action: 'rbac.analytics.resource_validation',
    });
    return baseQuery.eq('id', '__none__');
  }

  if (isAdminRole(user.role)) return baseQuery;

  const canonical = canonicalScopeFromUser(user);
  if (canonical.malformed) return baseQuery.eq('id', '__none__');

  if (resourceType === 'events') {
    return scopeEventsQuery(user, baseQuery);
  }

  if (resourceType === 'posts') {
    return baseQuery.eq('created_by', String(user.id ?? '').trim());
  }

  if (resourceType === 'profiles') {
    if (user.role === 'moderator') {
      return baseQuery
        .not('assigned_state_ids', 'is', null)
        .neq('assigned_state_ids', '{}')
        .containedBy('assigned_state_ids', canonical.stateIds);
    }
    const allowedRaw = Array.isArray(ctx.allowed_profile_ids) ? ctx.allowed_profile_ids.map((x) => String(x).trim()).filter(Boolean) : [];
    const allowed = toUuidList(allowedRaw);
    const scopeGids = campaignManagerScopeGroupIds(canonical, ctx);
    const gids = toGroupIdNums(scopeGids);
    if (allowed.length > 0 && gids.length > 0) {
      const ov = scopeGids.length > 0 ? `,assigned_group_ids.ov.{${scopeGids.join(',')}}` : '';
      return baseQuery.or(`id.in.(${allowed.join(',')}),group_id.in.(${gids.join(',')})${ov}`);
    }
    if (allowed.length > 0) return baseQuery.in('id', allowed);
    return gids.length > 0 ? baseQuery.in('group_id', gids) : baseQuery.eq('id', '__none__');
  }

  return baseQuery.eq('id', '__none__');
}

/**
 * Count/aggregation helper to keep RBAC-sensitive totals DB-scoped by default.
 * Use this for count/head queries to avoid accidental fetch-then-filter drift.
 */
export function buildScopedCountQuery(
  user: UnifiedUser,
  baseQuery: AnyQuery,
  resourceType: ScopedResourceType,
  ctx: ScopedQueryContext = {}
): AnyQuery {
  return buildScopedQuery(user, baseQuery, resourceType, ctx);
}

/**
 * Aggregation helper mirroring analytics scoping semantics.
 * Keeps metric queries semantically aligned with read/mutation RBAC.
 */
export function buildScopedAggregationQuery(
  user: UnifiedUser,
  baseQuery: AnyQuery,
  resourceType: Extract<ScopedResourceType, 'events' | 'profiles' | 'posts'>,
  ctx: ScopedQueryContext = {}
): AnyQuery {
  return buildScopedAnalyticsQuery(user, baseQuery, resourceType, ctx);
}

/**
 * Convenience helper to compute allowed profile IDs for campaign managers using group_memberships.
 * This does DB I/O and is meant to be used by APIs *before* building the main profiles query.
 */
export async function resolveAllowedProfileIdsForCampaignManager(
  admin: SupabaseClient,
  assigned_group_ids: unknown
): Promise<string[] | null> {
  const parsed = parseGroupIds(assigned_group_ids);
  if (parsed.malformed) return [];
  const gids = toGroupIdNums(parsed.ids);
  if (gids.length === 0) return [];
  /**
   * Pagination avoids single giant reads from group_memberships under large campaign datasets.
   * The resulting IDs are still returned as an array for caller compatibility.
   */
  const pageSize = 5000;
  const dedup = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('group_memberships')
      .select('user_id')
      .in('group_id', gids)
      .order('user_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return null;
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const id = String(r.user_id ?? '').trim();
      if (id) dedup.add(id);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 2000000) break;
  }
  return Array.from(dedup);
}

/**
 * Full campaign-manager group scope: profile `assigned_group_ids` ∪ every `group_memberships.group_id`
 * for this user. Mirrors mixed assignment storage (profile column vs membership rows).
 *
 * Returns `null` if `group_memberships` exists but the query failed (caller may fall back to profile-only).
 * Returns `[]` only when profile groups are malformed (parseGroupIds.malformed).
 */
export async function resolveEffectiveGroupIdsForCampaignManager(
  admin: SupabaseClient,
  userId: string,
  assigned_group_ids: unknown
): Promise<string[] | null> {
  const fromProfile = parseGroupIds(assigned_group_ids);
  if (fromProfile.malformed) return [];
  const dedup = new Set<string>(fromProfile.ids);

  const pageSize = 5000;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('group_memberships')
      .select('group_id')
      .eq('user_id', userId)
      .order('group_id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      const msg = String(error.message ?? '').toLowerCase();
      const missing =
        msg.includes('group_memberships') &&
        (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('not found'));
      if (missing) return Array.from(dedup);
      return null;
    }
    const rows = (data ?? []) as { group_id?: unknown }[];
    if (rows.length === 0) break;
    const chunk = parseGroupIds(rows.map((r) => r.group_id)).ids;
    for (const id of chunk) dedup.add(id);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 2000000) break;
  }
  return Array.from(dedup);
}

