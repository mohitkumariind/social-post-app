import type { SupabaseClient } from '@supabase/supabase-js';
import { toNumArray, toStrArray } from '@/lib/rbac/require';
import type { UnifiedUser } from '@/lib/rbac/unified-scope-engine';

export type ScopedResourceType =
  | 'events'
  | 'groups'
  | 'profiles'
  | 'notification_templates'
  | 'admin_logs';

type AnyQuery = any;

export type ScopedQueryContext = {
  /**
   * Optional precomputed IDs for scoping when a direct DB predicate isn't possible
   * (e.g. profiles visible via group_memberships).
   */
  allowed_profile_ids?: string[];
};

/**
 * Applies RBAC scoping at the DB query layer.
 * This is an optimization + security layer; Unified Scope Engine remains the source of truth.
 */
export function buildScopedQuery(
  user: UnifiedUser,
  baseQuery: AnyQuery,
  resourceType: ScopedResourceType,
  ctx: ScopedQueryContext = {}
): AnyQuery {
  const role = user.role;
  if (role === 'admin') return baseQuery;

  if (resourceType === 'notification_templates') {
    // Ownership-only resources
    return baseQuery.eq('created_by', user.id);
  }

  if (resourceType === 'groups') {
    if (role === 'moderator') return baseQuery.eq('created_by', user.id);
    // campaign_manager: assigned_group_ids are TEXT, groups.id is numeric; use .in with numeric conversion where possible.
    const gids = toNumArray(user.assigned_group_ids);
    return gids.length > 0 ? baseQuery.in('id', gids) : baseQuery.eq('id', -1);
  }

  if (resourceType === 'events') {
    if (role === 'moderator') {
      // Strict: ownership AND state overlap (existing behavior)
      return baseQuery.eq('created_by', user.id).overlaps('state_id', user.assigned_state_ids);
    }
    // campaign_manager: scope by assigned groups via overlaps on target_groups (array column)
    // If target_groups not present/empty, fall back to ownership to avoid over-exposing.
    const gidsStr = toStrArray(user.assigned_group_ids);
    if (gidsStr.length === 0) return baseQuery.eq('created_by', user.id);
    // Note: `target_groups` is stored as array (string/number); overlaps works for Postgres arrays.
    return baseQuery.overlaps('target_groups', gidsStr);
  }

  if (resourceType === 'profiles') {
    if (role === 'moderator') {
      // Existing: moderator sees only overlapping assigned_state_ids, and select cols is handled in API.
      return baseQuery.overlaps('assigned_state_ids', user.assigned_state_ids);
    }
    // campaign_manager: best DB-level filter is by allowed profile IDs (from group_memberships prequery)
    const allowed = Array.isArray(ctx.allowed_profile_ids) ? ctx.allowed_profile_ids.map((x) => String(x).trim()).filter(Boolean) : [];
    if (allowed.length > 0) return baseQuery.in('id', allowed);
    // Legacy fallback: profiles.group_id in assigned groups
    const gids = toNumArray(user.assigned_group_ids);
    return gids.length > 0 ? baseQuery.in('group_id', gids) : baseQuery.eq('id', '__none__');
  }

  if (resourceType === 'admin_logs') {
    if (role === 'campaign_manager') {
      const gids = toStrArray(user.assigned_group_ids);
      if (gids.length === 0) return baseQuery.eq('actor_user_id', user.id);
      const set = `{${gids.map((s) => String(s).replace(/"/g, '')).join(',')}}`;
      return baseQuery.or(`actor_user_id.eq.${user.id},scope_group_ids.ov.${set}`);
    }
    // moderator: own actions OR intersect assigned states
    const sids = toNumArray(user.assigned_state_ids);
    if (sids.length === 0) return baseQuery.eq('actor_user_id', user.id);
    const set = `{${sids.map((n) => Number(n)).join(',')}}`;
    return baseQuery.or(`actor_user_id.eq.${user.id},scope_state_ids.ov.${set}`);
  }

  // Safe fallback: ownership only
  return baseQuery.eq('created_by', user.id);
}

/**
 * Convenience helper to compute allowed profile IDs for campaign managers using group_memberships.
 * This does DB I/O and is meant to be used by APIs *before* building the main profiles query.
 */
export async function resolveAllowedProfileIdsForCampaignManager(
  admin: SupabaseClient,
  assigned_group_ids: unknown
): Promise<string[] | null> {
  const gids = toNumArray(assigned_group_ids);
  if (gids.length === 0) return [];
  const { data, error } = await admin.from('group_memberships').select('user_id').in('group_id', gids);
  if (error) return null;
  return Array.from(new Set((data ?? []).map((r: any) => String(r.user_id ?? '').trim()).filter(Boolean)));
}

