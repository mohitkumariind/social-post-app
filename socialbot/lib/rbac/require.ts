export type RbacRole = 'admin' | 'moderator' | 'campaign_manager';

export type RbacUser = {
  id: string;
  role: RbacRole;
  assigned_state_ids: number[];
  assigned_group_ids?: string[];
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

/**
 * Canonical RBAC identity model:
 * - state IDs: positive integers
 * - group IDs: canonical numeric strings (e.g. "01" -> "1")
 *
 * Why: mixed String/Number coercion can produce divergent authorization decisions
 * across query/access/mutation layers. Centralizing normalization keeps checks deterministic.
 */
type NormalizedIdsResult<T> = { ids: T[]; malformed: boolean };

function toTokenArray(v: unknown): unknown[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return [];
    if (s.includes(',')) return s.split(',').map((x) => x.trim()).filter(Boolean);
    return [s];
  }
  return [v];
}

export function normalizeStateId(v: unknown): number | null {
  if (v == null) return null;
  const s = typeof v === 'string' ? v.trim() : String(v);
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

export function normalizeGroupId(v: unknown): string | null {
  const n = normalizeStateId(v);
  return n == null ? null : String(n);
}

export function normalizeStateIds(v: unknown): number[] {
  return parseStateIds(v).ids;
}

export function normalizeGroupIds(v: unknown): string[] {
  return parseGroupIds(v).ids;
}

export function parseStateIds(v: unknown): NormalizedIdsResult<number> {
  const tokens = toTokenArray(v);
  const out: number[] = [];
  let malformed = false;
  for (const token of tokens) {
    const normalized = normalizeStateId(token);
    if (normalized == null) {
      if (token != null && String(token).trim() !== '') malformed = true;
      continue;
    }
    out.push(normalized);
  }
  return { ids: Array.from(new Set(out)), malformed };
}

export function parseGroupIds(v: unknown): NormalizedIdsResult<string> {
  const tokens = toTokenArray(v);
  const out: string[] = [];
  let malformed = false;
  for (const token of tokens) {
    const normalized = normalizeGroupId(token);
    if (normalized == null) {
      if (token != null && String(token).trim() !== '') malformed = true;
      continue;
    }
    out.push(normalized);
  }
  return { ids: Array.from(new Set(out)), malformed };
}

export function normalizeActorId(v: unknown): string {
  return String(v ?? '').trim();
}

export function toNumArray(v: unknown): number[] {
  return normalizeStateIds(v);
}

export function toStrArray(v: unknown): string[] {
  return parseGroupIds(v).ids;
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

/**
 * Symmetric assignment guard for campaign managers.
 * Keep role preconditions deterministic across RBAC layers:
 * moderator => assigned states required
 * campaign_manager => assigned groups required
 */
export function requireCampaignManagerHasAssignedGroups(user: Pick<RbacUser, 'role' | 'assigned_group_ids'>): void {
  if (user.role !== 'campaign_manager') return;
  const parsed = parseGroupIds(user.assigned_group_ids);
  if (parsed.malformed || parsed.ids.length === 0) {
    throw new RbacError('Campaign manager is missing assigned_group_ids', 403);
  }
}

/**
 * Standard route-level RBAC preconditions.
 * Use this for admin APIs that support moderator/campaign_manager roles so new endpoints
 * do not forget assignment integrity checks.
 */
export function requireStandardRbacContext(
  user: Pick<RbacUser, 'role' | 'assigned_state_ids' | 'assigned_group_ids'>,
  roles: RbacRole[]
): void {
  requireRole(user, roles);
  requireModeratorHasAssignedStates(user);
  requireCampaignManagerHasAssignedGroups(user);
}

export function requireOwnership(resourceCreatedBy: unknown, userId: string): void {
  const owner = normalizeActorId(resourceCreatedBy);
  if (!owner || owner !== normalizeActorId(userId)) throw new RbacError('Forbidden', 403);
}

/**
 * State scope check.
 * Canonical RBAC semantics: SUBSET only.
 * Resource scope must be fully contained in viewer assignments.
 */
export function requireScopeState(resourceStateIds: unknown, assignedStateIds: number[], mode: 'subset' | 'overlap' = 'subset'): void {
  const resourceParsed = parseStateIds(resourceStateIds);
  const assignedParsed = parseStateIds(assignedStateIds);
  if (resourceParsed.malformed || assignedParsed.malformed) throw new RbacError('Forbidden', 403);
  const resource = resourceParsed.ids;
  const assigned = assignedParsed.ids;
  if (assigned.length === 0) throw new RbacError('Forbidden', 403);
  if (resource.length === 0) throw new RbacError('Forbidden', 403);
  const set = new Set(assigned);
  // Backward-compatible signature: reject non-subset mode to avoid semantic drift.
  if (mode !== 'subset') throw new RbacError('Forbidden', 403);
  if (!resource.every((n) => set.has(n))) throw new RbacError('Forbidden', 403);
}

export function requireGroupScope(resourceGroupIds: unknown, ownedGroups: unknown): void {
  const resParsed = parseGroupIds(resourceGroupIds);
  const ownedParsed = parseGroupIds(ownedGroups);
  if (resParsed.malformed || ownedParsed.malformed) throw new RbacError('Forbidden', 403);
  const res = resParsed.ids;
  const owned = new Set(ownedParsed.ids);
  if (res.length === 0) throw new RbacError('Forbidden', 403);
  if (owned.size === 0) throw new RbacError('Forbidden', 403);
  if (!res.every((g) => owned.has(g))) throw new RbacError('Forbidden', 403);
}

/**
 * Campaign manager group assignment check (parallel to moderator assigned_state_ids).
 * - admin: bypass
 * - campaign_manager: groupId must be included in assigned_group_ids
 * - moderator: unchanged / not applicable here
 */
export function requireGroupAssignment(
  user: Pick<RbacUser, 'role' | 'assigned_group_ids'>,
  groupId: unknown
): void {
  if (user.role === 'admin') return;
  if (user.role !== 'campaign_manager') return;
  const assignedParsed = parseGroupIds(user.assigned_group_ids);
  const gid = normalizeGroupId(groupId) ?? '';
  if (assignedParsed.malformed) throw new RbacError('Forbidden', 403);
  const assigned = new Set(assignedParsed.ids);
  if (!gid) throw new RbacError('Forbidden', 403);
  if (assigned.size === 0) throw new RbacError('Forbidden', 403);
  if (!assigned.has(gid)) throw new RbacError('Forbidden', 403);
}

