import { PARTIES_DATA } from '@/lib/constants';
import { normalizeAssignedPartyIds } from '@/lib/admin/editor-party-scope';
import { parseGroupIds, parseStateIds } from '@/lib/rbac/require';
import type {
  CanonicalScope,
  RbacActor,
  NormalizedEventResource,
  ScopeDimensionWildcards,
} from '@/lib/rbac/scope-types';
import { PUBLISHED_EVENT_STATUSES } from '@/lib/rbac/scope-types';
import { isActiveEventDashboardCategory } from '@/lib/dashboard-event-category';

const GLOBAL_WILDCARD = 0;

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

function parseNumericIds(v: unknown): { ids: number[]; hasWildcard: boolean; malformed: boolean } {
  const tokens = toTokenArray(v);
  const out: number[] = [];
  let hasWildcard = false;
  let malformed = false;
  for (const token of tokens) {
    const s = String(token ?? '').trim();
    if (!s) continue;
    if (s.toUpperCase() === 'ALL') {
      hasWildcard = true;
      continue;
    }
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n < 0) {
      malformed = true;
      continue;
    }
    if (n === GLOBAL_WILDCARD) {
      hasWildcard = true;
      continue;
    }
    if (n > 0) out.push(n);
  }
  return { ids: Array.from(new Set(out)), hasWildcard, malformed };
}

function parsePartySlugs(v: unknown): string[] {
  const tokens = toTokenArray(v);
  return tokens
    .map((x) => String(x ?? '').trim().toLowerCase())
    .filter((s) => s.length > 0 && s !== 'all');
}

function slugToNumericPartyId(slug: string): number | null {
  const key = slug.trim().toLowerCase();
  const row = PARTIES_DATA.find((p) => p.id.toLowerCase() === key);
  const numericId = (row as { numericId?: number } | undefined)?.numericId;
  if (numericId != null && Number.isFinite(numericId)) return numericId;
  return null;
}

function expandPartySlugsToNumeric(slugs: string[]): number[] {
  const out: number[] = [];
  for (const slug of slugs) {
    const n = slugToNumericPartyId(slug);
    if (n != null) out.push(n);
  }
  return Array.from(new Set(out));
}

/**
 * Normalize any resource or payload into canonical scope arrays.
 * Accepts legacy DB/API keys: state_id, party_id, target_groups, loksabha_id, assembly_id, state, party.
 */
function parseStateScope(v: unknown): { ids: number[]; hasWildcard: boolean; malformed: boolean } {
  const numeric = parseNumericIds(v);
  const parsed = parseStateIds(v);
  return {
    ids: parsed.ids,
    hasWildcard: numeric.hasWildcard,
    malformed: parsed.malformed || numeric.malformed,
  };
}

export function normalizeResourceScope(raw: Record<string, unknown> | null | undefined): CanonicalScope {
  const r = raw ?? {};
  const states = parseStateScope(
    r.state_ids ?? r.state_id ?? r.assigned_state_ids ?? r.state
  );
  const parties = parseNumericIds(r.party_ids ?? r.party_id);
  const partySlugs = parsePartySlugs(r.party ?? r.party_slugs);
  const lok = parseNumericIds(r.loksabha_ids ?? r.loksabha_id ?? r.loksabha);
  const asm = parseNumericIds(r.assembly_ids ?? r.assembly_id ?? r.assembly);
  const groups = parseGroupIds(r.group_ids ?? r.group_id ?? r.target_groups ?? r.target_groups);

  const partyIdsFromSlugs = expandPartySlugsToNumeric(partySlugs);
  const party_ids = Array.from(new Set([...parties.ids, ...partyIdsFromSlugs]));

  const wildcards: ScopeDimensionWildcards = {};
  if (states.hasWildcard) wildcards.state = true;
  if (parties.hasWildcard) wildcards.party = true;
  if (lok.hasWildcard) wildcards.loksabha = true;
  if (asm.hasWildcard) wildcards.assembly = true;

  const scope: CanonicalScope & { _wildcard?: boolean } = {
    state_ids: states.ids,
    party_ids,
    party_slugs: partySlugs,
    loksabha_ids: lok.ids,
    assembly_ids: asm.ids,
    group_ids: groups.ids,
  };
  if (Object.keys(wildcards).length > 0) scope.wildcards = wildcards;
  if (states.hasWildcard || parties.hasWildcard || lok.hasWildcard || asm.hasWildcard) {
    scope._wildcard = true;
  }
  return scope;
}

export function scopeDimensionWildcard(
  scope: CanonicalScope,
  dimension: keyof ScopeDimensionWildcards
): boolean {
  return scope.wildcards?.[dimension] === true;
}

export function scopeHasGlobalWildcard(scope: CanonicalScope): boolean {
  return (scope as CanonicalScope & { _wildcard?: boolean })._wildcard === true;
}

/** True when event/CM payload anchors on groups and/or constituency (incl. ALL seats). */
export function hasConstituencyAnchor(scope: CanonicalScope): boolean {
  if (scope.group_ids.length > 0) return true;
  if (scope.loksabha_ids.length > 0 || scopeDimensionWildcard(scope, 'loksabha')) return true;
  if (scope.assembly_ids.length > 0 || scopeDimensionWildcard(scope, 'assembly')) return true;
  return false;
}

/**
 * Actor assignment scope from session profile.
 */
export function normalizeScope(actor: Pick<
  RbacActor,
  | 'assigned_state_ids'
  | 'assigned_group_ids'
  | 'assigned_party_ids'
  | 'assigned_loksabha_ids'
  | 'assigned_assembly_ids'
>): CanonicalScope {
  const states = parseStateIds(actor.assigned_state_ids);
  const groups = parseGroupIds(actor.assigned_group_ids);
  const partySlugs = normalizeAssignedPartyIds(actor.assigned_party_ids);
  const lok = parseNumericIds(actor.assigned_loksabha_ids ?? []);
  const asm = parseNumericIds(actor.assigned_assembly_ids ?? []);

  const wildcards: ScopeDimensionWildcards = {};
  if (lok.hasWildcard) wildcards.loksabha = true;
  if (asm.hasWildcard) wildcards.assembly = true;

  const scope: CanonicalScope = {
    state_ids: states.ids,
    party_ids: expandPartySlugsToNumeric(partySlugs),
    party_slugs: partySlugs,
    loksabha_ids: lok.ids,
    assembly_ids: asm.ids,
    group_ids: groups.ids,
  };
  if (Object.keys(wildcards).length > 0) scope.wildcards = wildcards;
  return scope;
}

export function normalizeEventResource(row: Record<string, unknown>): NormalizedEventResource {
  const scope = normalizeResourceScope(row);
  return {
    ...scope,
    created_by: row.created_by != null ? String(row.created_by).trim() : null,
    created_role: row.created_role != null ? String(row.created_role).trim().toLowerCase() : null,
    status: row.status != null ? String(row.status).trim().toLowerCase() : null,
    published_at: row.published_at != null ? String(row.published_at) : null,
    dashboard_category: row.dashboard_category,
  };
}

/** True when payload attempts admin-only global / all-India targeting. */
export function isGlobalTargeting(scope: CanonicalScope, extra?: { dashboard_category?: unknown }): boolean {
  if (extra?.dashboard_category != null && isActiveEventDashboardCategory(extra.dashboard_category)) {
    return true;
  }
  const check = (ids: number[]) => ids.includes(GLOBAL_WILDCARD);
  if (scopeDimensionWildcard(scope, 'state') || check(scope.state_ids)) return true;
  if (scopeDimensionWildcard(scope, 'party') || check(scope.party_ids)) return true;
  const groupNums = scope.group_ids.map((g) => Number(g)).filter((n) => Number.isFinite(n));
  if (groupNums.includes(GLOBAL_WILDCARD)) return true;
  return false;
}

export function isPublishedEvent(event: Pick<NormalizedEventResource, 'status' | 'published_at'>): boolean {
  const status = String(event.status ?? '').toLowerCase();
  if ((PUBLISHED_EVENT_STATUSES as readonly string[]).includes(status)) return true;
  if (event.published_at && String(event.published_at).trim()) return true;
  return false;
}
