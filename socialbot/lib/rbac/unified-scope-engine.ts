import { toNumArray, toStrArray, type RbacRole } from '@/lib/rbac/require';

export type UnifiedScope =
  | { type: 'GLOBAL' }
  | { type: 'STATE'; states: number[] }
  | { type: 'GROUP'; groups: string[] };

export type UnifiedUser = {
  id: string;
  role: RbacRole;
  assigned_state_ids: number[];
  assigned_group_ids?: string[];
};

export type UnifiedResource = {
  created_by?: unknown;
  state_ids?: unknown;
  group_id?: unknown;
  group_ids?: unknown;
};

export function resolveScope(user: Pick<UnifiedUser, 'role' | 'assigned_state_ids' | 'assigned_group_ids'>): UnifiedScope {
  if (user.role === 'admin') return { type: 'GLOBAL' };
  if (user.role === 'moderator') return { type: 'STATE', states: toNumArray(user.assigned_state_ids) };
  return { type: 'GROUP', groups: toStrArray(user.assigned_group_ids) };
}

function isOwner(userId: string, createdBy: unknown): boolean {
  const owner = String(createdBy ?? '').trim();
  return !!owner && owner === String(userId ?? '').trim();
}

function stateScopeAllows(scope: Extract<UnifiedScope, { type: 'STATE' }>, resource: UnifiedResource): boolean {
  const assigned = new Set(toNumArray(scope.states).map(Number));
  if (assigned.size === 0) return false;
  const rStates = toNumArray(resource.state_ids);
  if (rStates.length === 0) return false;
  // STRICT: require subset to avoid weakening existing moderator protections.
  return rStates.every((n) => assigned.has(Number(n)));
}

function groupScopeAllows(scope: Extract<UnifiedScope, { type: 'GROUP' }>, resource: UnifiedResource): boolean {
  const assigned = new Set(toStrArray(scope.groups));
  if (assigned.size === 0) return false;

  const gid = String(resource.group_id ?? '').trim();
  const gids = toStrArray(resource.group_ids);

  if (gid) return assigned.has(gid);
  if (gids.length > 0) return gids.every((g) => assigned.has(g));
  return false;
}

/**
 * Central RBAC decision.
 *
 * Rules (non-weakening):
 * - Admin: always true
 * - Moderator: requires resource.state_ids subset of assigned_state_ids
 * - Campaign manager: requires resource.group_id or group_ids subset of assigned_group_ids
 * - Ownership: allows access only when the resource has no scope fields (backward-compatible for legacy rows)
 * - Default: false
 */
export function canAccessResource(user: UnifiedUser, resource: UnifiedResource): boolean {
  if (user.role === 'admin') return true;

  const scope = resolveScope(user);
  if (scope.type === 'STATE') {
    const rStates = toNumArray(resource.state_ids);
    if (rStates.length === 0) return isOwner(user.id, resource.created_by);
    return stateScopeAllows(scope, resource);
  }
  if (scope.type === 'GROUP') {
    const gid = String(resource.group_id ?? '').trim();
    const gids = toStrArray(resource.group_ids);
    if (!gid && gids.length === 0) return isOwner(user.id, resource.created_by);
    return groupScopeAllows(scope, resource);
  }
  return false;
}

