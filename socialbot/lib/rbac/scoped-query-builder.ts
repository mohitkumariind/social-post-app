import type { SupabaseClient } from '@supabase/supabase-js';
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

export type ScopedQueryContext = {
  /**
   * Optional precomputed IDs for scoping when a direct DB predicate isn't possible
   * (e.g. profiles visible via group_memberships).
   */
  allowed_profile_ids?: string[];
};

/**
 * Applies RBAC scoping at the DB query layer.
 *
 * Canonical semantics (enterprise-safe):
 * - Non-admin access is subset-scoped, not overlap-scoped.
 * - Resource scope fields must be present (missing scope is denied/fail-closed).
 * - Unknown/unregistered resources are denied explicitly (no silent fallback behavior).
 *
 * This layer intentionally mirrors Unified Scope Engine semantics to avoid RBAC drift.
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

  const role = user.role;
  if (role === 'admin') return baseQuery;
  const canonical = canonicalScopeFromUser(user);
  if (canonical.malformed) return baseQuery.eq('id', '__none__');

  if (resourceType === 'notification_templates') {
    // Ownership-only resources
    return baseQuery.eq('created_by', user.id);
  }

  if (resourceType === 'groups') {
    if (role === 'moderator') return baseQuery.eq('created_by', user.id);
    const gids = toGroupIdNums(canonical.groupIds);
    return gids.length > 0 ? baseQuery.in('id', gids) : baseQuery.eq('id', -1);
  }

  if (resourceType === 'events') {
    if (role === 'moderator') {
      // Require event.state_id subset of moderator assigned_state_ids.
      return baseQuery.not('state_id', 'is', null).neq('state_id', '{}').containedBy('state_id', canonical.stateIds);
    }
    // campaign_manager: require event.target_groups subset of assigned_group_ids.
    if (canonical.groupIds.length === 0) return baseQuery.eq('id', '__none__');
    return baseQuery.not('target_groups', 'is', null).neq('target_groups', '{}').containedBy('target_groups', canonical.groupIds);
  }

  if (resourceType === 'profiles') {
    if (role === 'moderator') {
      // Require profile.assigned_state_ids subset of moderator assigned_state_ids.
      return baseQuery.not('assigned_state_ids', 'is', null).neq('assigned_state_ids', '{}').containedBy('assigned_state_ids', canonical.stateIds);
    }
    // campaign_manager: best DB-level filter is by allowed profile IDs (from group_memberships prequery)
    const allowed = Array.isArray(ctx.allowed_profile_ids) ? ctx.allowed_profile_ids.map((x) => String(x).trim()).filter(Boolean) : [];
    if (allowed.length > 0) return baseQuery.in('id', allowed);
    // Legacy fallback: profiles.group_id in assigned groups
    const gids = toGroupIdNums(canonical.groupIds);
    return gids.length > 0 ? baseQuery.in('group_id', gids) : baseQuery.eq('id', '__none__');
  }

  if (resourceType === 'posts') {
    if (role === 'moderator') {
      // Require post.state_id subset of moderator assigned_state_ids.
      return baseQuery.not('state_id', 'is', null).neq('state_id', '{}').containedBy('state_id', canonical.stateIds);
    }
    // campaign_manager: group-only scoping (indexed). If no groups are assigned, return empty.
    const gids = toGroupIdNums(canonical.groupIds);
    return gids.length > 0 ? baseQuery.in('group_id', gids) : baseQuery.eq('id', '__none__');
  }

  if (resourceType === 'admin_logs') {
    if (role === 'campaign_manager') {
      if (canonical.groupIds.length === 0) return baseQuery.eq('id', '__none__');
      return baseQuery.not('scope_group_ids', 'is', null).neq('scope_group_ids', '{}').containedBy('scope_group_ids', canonical.groupIds);
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

  const role = user.role;
  if (role === 'admin') return baseQuery;
  const canonical = canonicalScopeFromUser(user);
  if (canonical.malformed) return baseQuery.eq('id', '__none__');

  if (resourceType === 'profiles') {
    if (role === 'moderator') return baseQuery.not('assigned_state_ids', 'is', null).neq('assigned_state_ids', '{}').containedBy('assigned_state_ids', canonical.stateIds);
    const allowed = Array.isArray(ctx.allowed_profile_ids) ? ctx.allowed_profile_ids.map((x) => String(x).trim()).filter(Boolean) : [];
    if (allowed.length > 0) return baseQuery.in('id', allowed);
    const gids = toGroupIdNums(canonical.groupIds);
    return gids.length > 0 ? baseQuery.in('group_id', gids) : baseQuery.eq('id', '__none__');
  }

  if (resourceType === 'events') {
    if (role === 'moderator') return baseQuery.not('state_id', 'is', null).neq('state_id', '{}').containedBy('state_id', canonical.stateIds);
    return canonical.groupIds.length > 0
      ? baseQuery.not('target_groups', 'is', null).neq('target_groups', '{}').containedBy('target_groups', canonical.groupIds)
      : baseQuery.eq('id', '__none__');
  }

  // posts
  if (role === 'moderator') return baseQuery.not('state_id', 'is', null).neq('state_id', '{}').containedBy('state_id', canonical.stateIds);
  const gids = toGroupIdNums(canonical.groupIds);
  return gids.length > 0 ? baseQuery.in('group_id', gids) : baseQuery.eq('id', '__none__');
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

