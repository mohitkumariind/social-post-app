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
      if (canonical.stateIds.length === 0) {
        return baseQuery.not('dashboard_category', 'is', null).eq('created_by', user.id);
      }
      const sidList = canonical.stateIds.join(',');
      // state_id containing 0 means "All states" — visible to any moderator with assignments.
      const branchAllStates = 'state_id.ov.{0}';
      const branch1 = `and(state_id.not.is.null,state_id.neq.{},state_id.cd.{${sidList}})`;
      const branch2 = `and(dashboard_category.not.is.null,created_by.eq.${user.id})`;
      return baseQuery.or(`${branchAllStates},${branch1},${branch2}`);
    }
    // campaign_manager: require event.target_groups subset of assigned (effective) group ids.
    // Use normalized string IDs for PostgREST: `events.target_groups` is text[] (numeric strings) in canonical schema;
    // passing number[] can break `<@` / `containedBy` matching against text[].
    const scopeGids = campaignManagerScopeGroupIds(canonical, ctx);
    if (scopeGids.length === 0) {
      return baseQuery.not('dashboard_category', 'is', null).eq('created_by', user.id);
    }
    const gidList = scopeGids.join(',');
    const branch1 = `and(target_groups.not.is.null,target_groups.neq.{},target_groups.cd.{${gidList}})`;
    const branch2 = `and(dashboard_category.not.is.null,created_by.eq.${user.id})`;
    return baseQuery.or(`${branch1},${branch2}`);
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

  if (resourceType === 'posts') {
    if (role === 'moderator') {
      // Require post.state_id subset of moderator assigned_state_ids.
      return baseQuery.not('state_id', 'is', null).neq('state_id', '{}').containedBy('state_id', canonical.stateIds);
    }
    // campaign_manager: group-only scoping (indexed). If no groups are assigned, return empty.
    const gids = toGroupIdNums(campaignManagerScopeGroupIds(canonical, ctx));
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

  const role = user.role;
  if (role === 'admin') return baseQuery;
  const canonical = canonicalScopeFromUser(user);
  if (canonical.malformed) return baseQuery.eq('id', '__none__');

  if (resourceType === 'profiles') {
    if (role === 'moderator') return baseQuery.not('assigned_state_ids', 'is', null).neq('assigned_state_ids', '{}').containedBy('assigned_state_ids', canonical.stateIds);
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

  if (resourceType === 'events') {
    if (role === 'moderator') {
      if (canonical.stateIds.length === 0) {
        return baseQuery.not('dashboard_category', 'is', null).eq('created_by', user.id);
      }
      const sidList = canonical.stateIds.join(',');
      const branchAllStates = 'state_id.ov.{0}';
      const branch1 = `and(state_id.not.is.null,state_id.neq.{},state_id.cd.{${sidList}})`;
      const branch2 = `and(dashboard_category.not.is.null,created_by.eq.${user.id})`;
      return baseQuery.or(`${branchAllStates},${branch1},${branch2}`);
    }
    const scopeGids = campaignManagerScopeGroupIds(canonical, ctx);
    if (scopeGids.length === 0) {
      return baseQuery.not('dashboard_category', 'is', null).eq('created_by', user.id);
    }
    const gidList = scopeGids.join(',');
    const branch1 = `and(target_groups.not.is.null,target_groups.neq.{},target_groups.cd.{${gidList}})`;
    const branch2 = `and(dashboard_category.not.is.null,created_by.eq.${user.id})`;
    return baseQuery.or(`${branch1},${branch2}`);
  }

  // posts
  if (role === 'moderator') return baseQuery.not('state_id', 'is', null).neq('state_id', '{}').containedBy('state_id', canonical.stateIds);
  const gids = toGroupIdNums(campaignManagerScopeGroupIds(canonical, ctx));
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

