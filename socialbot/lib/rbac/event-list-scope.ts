import type { VerifiedAdminAuth } from '@/lib/admin-gate';
import { isEventsFullAdmin } from '@/lib/event-access';
import { filterVisibleEvents, type RbacActor } from '@/lib/rbac/permission-engine';
import { PUBLISHED_EVENT_STATUSES } from '@/lib/rbac/scope-types';

type AnyQuery = { or: (filter: string) => AnyQuery; eq: (col: string, val: string) => AnyQuery };

/**
 * @deprecated Event listings use {@link buildScopedQuery} from `scoped-query-builder.ts` only.
 * DB pre-filter for event listings: own rows + published rows with state overlap.
 * Party / creator-role visibility is enforced in-memory via {@link filterVisibleEvents}.
 */
export function applyEventsListQueryScope(
  auth: Pick<VerifiedAdminAuth, 'role' | 'user' | 'assigned_state_ids'>,
  query: AnyQuery
): AnyQuery {
  if (isEventsFullAdmin(auth)) return query;

  const userId = String(auth.user.id).trim();
  const states = (auth.assigned_state_ids ?? []).filter((n) => Number.isFinite(n) && n > 0);
  const published = PUBLISHED_EVENT_STATUSES.join(',');

  if (states.length === 0) {
    return query.eq('created_by', userId);
  }

  const stateList = states.join(',');
  return query.or(
    `created_by.eq.${userId},and(status.in.(${published}),state_id.ov.{${stateList}})`
  );
}

/** @deprecated Use DB-only {@link buildScopedQuery} for event listings; do not post-filter. */
export function postFilterEventsList<T extends Record<string, unknown>>(
  auth: VerifiedAdminAuth,
  rows: T[]
): T[] {
  if (isEventsFullAdmin(auth)) return rows;
  const actor: RbacActor = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
    assigned_party_ids: auth.assigned_party_ids,
  };
  return filterVisibleEvents(actor, rows);
}
