export type RbacRole = 'admin' | 'moderator' | 'campaign_manager';

export type RbacUser = {
  id: string;
  role: RbacRole;
  assigned_state_ids: number[];
  owned_groups?: (string | number)[];
};

export class RbacError extends Error {
  status: 401 | 403;
  constructor(message: string, status: 401 | 403 = 403) {
    super(message);
    this.name = 'RbacError';
    this.status = status;
  }
}

export function toNumArray(v: unknown): number[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  const n = Number(v);
  return Number.isFinite(n) ? [n] : [];
}

export function toStrArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x ?? '').trim()).filter(Boolean);
  const s = String(v ?? '').trim();
  return s ? [s] : [];
}

export function requireRole(user: Pick<RbacUser, 'role'> | null | undefined, roles: RbacRole[]): void {
  const role = user?.role;
  if (!role) throw new RbacError('Unauthorized', 401);
  if (!roles.includes(role)) throw new RbacError('Forbidden', 403);
}

export function requireModeratorHasAssignedStates(user: Pick<RbacUser, 'role' | 'assigned_state_ids'>): void {
  if (user.role === 'moderator' && (!Array.isArray(user.assigned_state_ids) || user.assigned_state_ids.length === 0)) {
    throw new RbacError('Moderator is missing assigned_state_ids', 403);
  }
}

export function requireOwnership(resourceCreatedBy: unknown, userId: string): void {
  const owner = String(resourceCreatedBy ?? '').trim();
  if (!owner || owner !== String(userId ?? '').trim()) throw new RbacError('Forbidden', 403);
}

/**
 * State scope check.
 * Default mode is SUBSET (resource must be fully within the viewer's assigned states).
 */
export function requireScopeState(resourceStateIds: unknown, assignedStateIds: number[], mode: 'subset' | 'overlap' = 'subset'): void {
  const resource = toNumArray(resourceStateIds);
  const assigned = toNumArray(assignedStateIds);
  if (assigned.length === 0) throw new RbacError('Forbidden', 403);
  if (resource.length === 0) throw new RbacError('Forbidden', 403);
  const set = new Set(assigned.map(Number));
  if (mode === 'subset') {
    if (!resource.every((n) => set.has(Number(n)))) throw new RbacError('Forbidden', 403);
    return;
  }
  // overlap
  if (!resource.some((n) => set.has(Number(n)))) throw new RbacError('Forbidden', 403);
}

export function requireGroupScope(resourceGroupIds: unknown, ownedGroups: unknown): void {
  const res = toStrArray(resourceGroupIds);
  const owned = new Set(toStrArray(ownedGroups));
  if (res.length === 0) throw new RbacError('Forbidden', 403);
  if (owned.size === 0) throw new RbacError('Forbidden', 403);
  if (!res.every((g) => owned.has(g))) throw new RbacError('Forbidden', 403);
}

