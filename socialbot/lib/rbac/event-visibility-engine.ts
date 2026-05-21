/**
 * Single source of truth for event read visibility (list + detail).
 *
 * Visible when:
 * - owner (created_by = actor), OR
 * - published + state overlap + party overlap, OR
 * - published + active dashboard_category (global feed)
 */
import { PARTIES_DATA } from '@/lib/constants';
import { normalizeAssignedPartyIds } from '@/lib/admin/editor-party-scope';
import {
  EVENT_DASHBOARD_CATEGORY_VALUES,
  isActiveEventDashboardCategory,
} from '@/lib/dashboard-event-category';
import { isAdminRole } from '@/lib/rbac/dashboard-permissions';
import { isPublishedEvent, normalizeEventResource } from '@/lib/rbac/normalize-scope';
import { getCachedNormalizedScope } from '@/lib/rbac/scope-cache';
import type { CanonicalScope, NormalizedEventResource, RbacActor } from '@/lib/rbac/scope-types';
import { PUBLISHED_EVENT_STATUSES } from '@/lib/rbac/scope-types';
import { normalizeActorId, parseStateIds } from '@/lib/rbac/require';
import type { UnifiedUser } from '@/lib/rbac/unified-scope-engine';

function idsOverlap(resourceIds: number[], assignedIds: number[]): boolean {
  if (resourceIds.length === 0) return true;
  if (assignedIds.length === 0) return false;
  const set = new Set(assignedIds);
  return resourceIds.some((id) => set.has(id));
}

function slugsOverlap(resourceSlugs: string[], assignedSlugs: string[]): boolean {
  if (resourceSlugs.length === 0) return true;
  if (assignedSlugs.length === 0) return true;
  const set = new Set(assignedSlugs.map((s) => s.toLowerCase()));
  return resourceSlugs.some((s) => set.has(s.toLowerCase()));
}

export function partyOverlap(
  resource: Pick<CanonicalScope, 'party_ids' | 'party_slugs'>,
  actor: Pick<CanonicalScope, 'party_ids' | 'party_slugs'>
): boolean {
  const rIds = resource.party_ids;
  const aIds = actor.party_ids;
  const rSlugs = resource.party_slugs;
  const aSlugs = actor.party_slugs;

  if (rIds.length === 0 && rSlugs.length === 0) return true;
  if (aIds.length === 0 && aSlugs.length === 0) return true;

  if (rIds.length > 0 && aIds.length > 0 && idsOverlap(rIds, aIds)) return true;
  if (rSlugs.length > 0 && aSlugs.length > 0 && slugsOverlap(rSlugs, aSlugs)) return true;

  if (rIds.length > 0 && aSlugs.length === 0 && aIds.length === 0) return true;
  if (rSlugs.length > 0 && aSlugs.length === 0 && aIds.length === 0) return true;

  return false;
}

function stateVisibilityMatch(resource: CanonicalScope, actor: CanonicalScope): boolean {
  if (resource.state_ids.length === 0) return false;
  if (actor.state_ids.length === 0) return false;
  return idsOverlap(resource.state_ids, actor.state_ids);
}

/** Published cross-role visibility: same state AND same party (empty party = all within scope). */
export function eventVisibilityMatch(resource: NormalizedEventResource, actorScope: CanonicalScope): boolean {
  if (!stateVisibilityMatch(resource, actorScope)) return false;
  return partyOverlap(resource, actorScope);
}

type AnyQuery = {
  or: (filter: string) => AnyQuery;
  eq: (col: string, val: string) => AnyQuery;
};

export type EventVisibilityUser = Pick<
  UnifiedUser,
  'id' | 'role' | 'assigned_state_ids' | 'assigned_party_ids'
>;

function partyNumericIdsFromSlugs(slugs: string[]): number[] {
  const out: number[] = [];
  for (const slug of slugs) {
    const key = slug.trim().toLowerCase();
    const row = PARTIES_DATA.find((p) => p.id.toLowerCase() === key);
    const numericId = (row as { numericId?: number } | undefined)?.numericId;
    if (numericId != null && Number.isFinite(numericId)) out.push(numericId);
  }
  return Array.from(new Set(out));
}

function ownsEvent(userId: string, createdBy: unknown): boolean {
  const owner = normalizeActorId(createdBy);
  return !!owner && owner === normalizeActorId(userId);
}

/** PostgREST `or` clause: published rows with active dashboard_category (global feed). */
export function publishedGlobalFeedOrClause(): string {
  const published = PUBLISHED_EVENT_STATUSES.join(',');
  const cats = EVENT_DASHBOARD_CATEGORY_VALUES.join(',');
  return `and(status.in.(${published}),dashboard_category.in.(${cats}))`;
}

/** PostgREST `or` clause: published rows with state overlap (+ party when actor has party limits). */
export function publishedStatePartyOrClause(
  stateIds: number[],
  assignedPartyIds: string[] | undefined
): string | null {
  if (stateIds.length === 0) return null;

  const published = PUBLISHED_EVENT_STATUSES.join(',');
  const stateList = [...new Set(stateIds)].join(',');
  let clause = `and(status.in.(${published}),state_id.ov.{${stateList}})`;

  const partySlugs = normalizeAssignedPartyIds(assignedPartyIds ?? []);
  const partyIds = partyNumericIdsFromSlugs(partySlugs);
  if (partySlugs.length > 0 || partyIds.length > 0) {
    const partyParts: string[] = ['party_id.is.null', 'party_id.eq.{}'];
    if (partyIds.length > 0) partyParts.push(`party_id.ov.{${partyIds.join(',')}}`);
    if (partySlugs.length > 0) partyParts.push(`party.ov.{${partySlugs.join(',')}}`);
    clause = `and(status.in.(${published}),state_id.ov.{${stateList}},or(${partyParts.join(',')}))`;
  }

  return clause;
}

/**
 * Applies unified event visibility at the DB layer (all non-admin roles).
 */
export function getEventVisibilityQuery(user: EventVisibilityUser, baseQuery: AnyQuery): AnyQuery {
  if (isAdminRole(user.role)) return baseQuery;

  const userId = String(user.id ?? '').trim();
  const stateIds = parseStateIds(user.assigned_state_ids).ids;
  const parts: string[] = [`created_by.eq.${userId}`, publishedGlobalFeedOrClause()];

  const stateParty = publishedStatePartyOrClause(stateIds, user.assigned_party_ids);
  if (stateParty) parts.push(stateParty);

  return baseQuery.or(parts.join(','));
}

/** In-memory visibility check (detail reads, must match {@link getEventVisibilityQuery}). */
export function isEventVisibleToActor(actor: RbacActor, rawEvent: Record<string, unknown>): boolean {
  if (isAdminRole(actor.role)) return true;

  const event = normalizeEventResource(rawEvent);
  if (ownsEvent(actor.id, event.created_by ?? null)) return true;

  if (isPublishedEvent(event) && isActiveEventDashboardCategory(event.dashboard_category)) {
    return true;
  }

  if (!isPublishedEvent(event)) return false;

  return eventVisibilityMatch(event, getCachedNormalizedScope(actor));
}
