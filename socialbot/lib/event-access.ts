import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';
import { toRbacActor } from '@/lib/admin-gate';
import { isSuperAdmin } from '@/lib/permissions';
import { isAdminRole } from '@/lib/rbac/dashboard-permissions';
import {
  canEditEvent,
  canTargetAudience,
  canUploadPost,
  canViewEvent,
  isGlobalTargeting,
  normalizeResourceScope,
} from '@/lib/rbac';
import { RbacError } from '@/lib/rbac/require';
import { isActiveEventDashboardCategory } from '@/lib/dashboard-event-category';
import { validateEditorPartyScope } from '@/lib/admin/editor-party-scope';
import { finalizeEditorEventTargetingPayload } from '@/lib/admin/editor-event-targeting';

export function isEventsFullAdmin(auth: Pick<VerifiedAdminAuth, 'role'>): boolean {
  return isAdminRole(auth.role) || isSuperAdmin(auth.role);
}

/** @deprecated Use applyEventsListQueryScope from event-list-scope for listings. */
export function applyEventsOwnershipScope<T extends { eq: (col: string, val: string) => T }>(
  auth: Pick<VerifiedAdminAuth, 'role' | 'user'>,
  query: T
): T {
  if (isEventsFullAdmin(auth)) return query;
  return query.eq('created_by', auth.user.id);
}

export function assertEventRowReadable(
  auth: VerifiedAdminAuth,
  row: Record<string, unknown>
): void {
  const decision = canViewEvent(toRbacActor(auth), row);
  if (!decision.allowed) {
    throw new RbacError(decision.denied_reason ?? 'Forbidden: event not visible', 403);
  }
}

export function assertEventRowEditable(
  auth: VerifiedAdminAuth,
  row: Record<string, unknown>
): void {
  const decision = canEditEvent(toRbacActor(auth), row);
  if (!decision.allowed) {
    throw new RbacError(decision.denied_reason ?? 'Forbidden: cannot edit event', 403);
  }
}

export function assertEventTargetingAllowed(
  auth: VerifiedAdminAuth,
  payload: Record<string, unknown>
): void {
  const scope = normalizeResourceScope(payload);
  const decision = canTargetAudience(toRbacActor(auth), {
    ...scope,
    dashboard_category: payload.dashboard_category,
  });
  if (!decision.allowed) {
    throw new RbacError(decision.denied_reason ?? 'Forbidden: targeting not allowed', 403);
  }
  if (!isEventsFullAdmin(auth) && isGlobalTargeting(scope, { dashboard_category: payload.dashboard_category })) {
    throw new RbacError('Forbidden: global targeting is admin-only', 403);
  }
}

export function toNumArray(v: unknown): number[] {
  if (v == null || v === '') return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

export type EditorEventScope = {
  assignedStateIds?: number[];
  assignedPartyIds?: string[];
};

/** Editor: require ≥1 state; optional party + Lok Sabha/Assembly; forbid global/group publish fields. */
export function validateEditorEventPayload(
  payload: Record<string, unknown>,
  mode: 'create' | 'patch',
  scope: EditorEventScope | number[] = []
): string | null {
  const assignedStateIds = Array.isArray(scope)
    ? scope
    : (scope.assignedStateIds ?? []);
  const assignedPartyIds = Array.isArray(scope) ? [] : (scope.assignedPartyIds ?? []);
  if (Object.prototype.hasOwnProperty.call(payload, 'dashboard_category')) {
    const dc = payload.dashboard_category;
    if (dc != null && dc !== '' && isActiveEventDashboardCategory(dc)) {
      return 'Forbidden: editor cannot create global dashboard category events';
    }
    (payload as { dashboard_category?: unknown }).dashboard_category = null;
  }

  const forbidden = [
    'state',
    'target_groups',
    'profile_ids',
    'group_id',
    'scheduled_at',
    'published_at',
    'published_by',
    'status',
  ] as const;
  for (const k of forbidden) {
    if (Object.prototype.hasOwnProperty.call(payload, k)) {
      delete (payload as Record<string, unknown>)[k];
    }
  }

  if (mode === 'create' || Object.prototype.hasOwnProperty.call(payload, 'state_id')) {
    const stateIds = toNumArray(payload.state_id);
    if (stateIds.length === 0) return 'Editor must select at least one state';
    if (stateIds.includes(0)) return 'Editor cannot use global / all-states targeting';
    const allowed = new Set(assignedStateIds.map((n) => Number(n)).filter((n) => Number.isFinite(n)));
    if (allowed.size > 0 && !stateIds.every((id) => allowed.has(id))) {
      return 'Forbidden: state outside editor assigned states';
    }
    (payload as { state_id: number[] }).state_id = stateIds;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'loksabha_id')) {
    const lokIds = toNumArray(payload.loksabha_id);
    if (lokIds.includes(0)) return 'Editor cannot use global / all-seats targeting';
    (payload as { loksabha_id: number[] }).loksabha_id = lokIds;
    delete (payload as { loksabha?: unknown }).loksabha;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'assembly_id')) {
    const asmIds = toNumArray(payload.assembly_id);
    if (asmIds.includes(0)) return 'Editor cannot use global / all-seats targeting';
    (payload as { assembly_id: number[] }).assembly_id = asmIds;
    delete (payload as { assembly?: unknown }).assembly;
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'party_id')) {
    const partyIds = toNumArray(payload.party_id).filter((n) => n !== 0);
    if (toNumArray(payload.party_id).includes(0)) {
      return 'Editor cannot use global / all-parties targeting';
    }
    (payload as { party_id: number[] }).party_id = partyIds;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'party')) {
    const raw = payload.party;
    const arr = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    if (arr.some((x) => String(x ?? '').trim().toUpperCase() === 'ALL')) {
      return 'Editor cannot use global / all-parties targeting';
    }
    const slugs = arr
      .map((x) => String(x ?? '').trim().toLowerCase())
      .filter((s) => s.length > 0 && s !== 'all');
    (payload as { party: string[] }).party = slugs;
  }

  const partyScopeErr = validateEditorPartyScope(payload, assignedPartyIds);
  if (partyScopeErr) return partyScopeErr;

  finalizeEditorEventTargetingPayload(payload);
  return null;
}

export function applyEditorEventCreateDefaults(payload: Record<string, unknown>): void {
  (payload as { status?: string }).status = 'draft';
  (payload as { scheduled_at?: unknown }).scheduled_at = null;
  (payload as { published_at?: unknown }).published_at = null;
  (payload as { published_by?: unknown }).published_by = null;
  (payload as { dashboard_category?: unknown }).dashboard_category = null;
}

/** Block non-admin from publishing / scheduling via patch. */
export function stripNonAdminPublishFields(
  auth: Pick<VerifiedAdminAuth, 'role'>,
  patch: Record<string, unknown>
): void {
  if (isEventsFullAdmin(auth)) return;
  delete (patch as { status?: unknown }).status;
  delete (patch as { scheduled_at?: unknown }).scheduled_at;
  delete (patch as { published_at?: unknown }).published_at;
  delete (patch as { published_by?: unknown }).published_by;
  if (Object.prototype.hasOwnProperty.call(patch, 'dashboard_category')) {
    const dc = patch.dashboard_category;
    if (dc != null && isActiveEventDashboardCategory(dc)) {
      delete (patch as { dashboard_category?: unknown }).dashboard_category;
    }
  }
}

function isMissingCreatedByColumn(err: { message?: string } | null | undefined): boolean {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes('created_by') && (msg.includes('does not exist') || msg.includes('column') || msg.includes('schema cache'));
}

export type PostEventAccessOk = {
  ok: true;
  event: { id: string; created_by: string | null; name: string };
  ownership_match: boolean;
  scope_match: boolean;
  access_reason: string;
};

export type PostEventAccessFail = {
  ok: false;
  error: string;
  reason: string;
  event_created_by?: string | null;
  ownership_match?: boolean;
  scope_match?: boolean;
};

export function logPostEventAccess(phase: string, detail: Record<string, unknown>) {
  console.log('[post-event-access]', phase, detail);
}

/**
 * Role-scoped event gate for post upload/update (not editor-only ownership).
 * - editor: must own event
 * - moderator: own event OR event state_id ⊆ assigned states
 * - campaign_manager: own event OR event target_groups ⊆ assigned groups
 * - admin/super_admin: any event
 */
export async function assertPostEventAccessibleForPostUpload(
  admin: SupabaseClient,
  eventId: string,
  auth: VerifiedAdminAuth
): Promise<PostEventAccessOk | PostEventAccessFail> {
  const id = String(eventId ?? '').trim();
  const actorId = String(auth.user.id).trim();
  if (!id) {
    return { ok: false, error: 'event_id is required', reason: 'missing_event_id' };
  }

  let selectCols =
    'id, created_by, created_role, name, status, published_at, state_id, party_id, party, target_groups, loksabha_id, assembly_id';
  let { data, error } = await admin.from('events').select(selectCols).eq('id', id).maybeSingle();
  if (error && isMissingCreatedByColumn(error)) {
    selectCols = 'id, name, status, state_id, party_id, party, target_groups, loksabha_id, assembly_id';
    ({ data, error } = await admin.from('events').select(selectCols).eq('id', id).maybeSingle());
  }
  if (error) return { ok: false, error: error.message, reason: 'event_lookup_error' };
  if (!data) return { ok: false, error: 'Event not found', reason: 'event_not_found' };

  const row = { ...(data as unknown as Record<string, unknown>) };
  let ownerStr = row.created_by != null ? String(row.created_by).trim() : '';

  if (!ownerStr && !isAdminRole(auth.role) && !isSuperAdmin(auth.role)) {
    const { error: backfillErr } = await admin
      .from('events')
      .update({ created_by: actorId })
      .eq('id', id)
      .is('created_by', null);
    if (!backfillErr) ownerStr = actorId;
    else if (isMissingCreatedByColumn(backfillErr)) ownerStr = actorId;
    else return { ok: false, error: backfillErr.message, reason: 'created_by_backfill_failed' };
    row.created_by = ownerStr;
  }

  const decision = canUploadPost(toRbacActor(auth), row);
  const dbg = decision.debug;

  logPostEventAccess(decision.allowed ? 'allow' : 'denied', {
    auth_role: auth.role,
    event_id: id,
    event_created_by: ownerStr || null,
    ownership_match: dbg.ownership_match,
    visibility_match: dbg.visibility_match,
    scope_match: dbg.mutation_permission,
    normalized_scope: dbg.normalized_scope,
    denied_reason: decision.denied_reason,
  });

  if (!decision.allowed) {
    return {
      ok: false,
      error: decision.denied_reason ?? 'Forbidden: cannot upload to this event',
      reason: decision.denied_reason ?? 'upload_denied',
      event_created_by: ownerStr || null,
      ownership_match: dbg.ownership_match,
      scope_match: dbg.mutation_permission,
    };
  }

  return {
    ok: true,
    event: {
      id,
      created_by: ownerStr || null,
      name: String(row.name ?? ''),
    },
    ownership_match: dbg.ownership_match,
    scope_match: dbg.mutation_permission,
    access_reason: dbg.ownership_match ? 'ownership' : 'scope_upload',
  };
}

export async function assertPostEventOwnedByActor(
  admin: SupabaseClient,
  eventId: string,
  actorUserId: string
): Promise<{ ok: true; event: { id: string; created_by: string | null; name: string } } | { ok: false; error: string }> {
  const id = String(eventId ?? '').trim();
  if (!id) return { ok: false, error: 'event_id is required' };

  const { data, error } = await admin.from('events').select('id, created_by, name').eq('id', id).maybeSingle();
  if (error && isMissingCreatedByColumn(error)) {
    const { data: legacy, error: legacyErr } = await admin.from('events').select('id, name').eq('id', id).maybeSingle();
    if (legacyErr) return { ok: false, error: legacyErr.message };
    if (!legacy) return { ok: false, error: 'Event not found' };
    return {
      ok: true,
      event: {
        id: String((legacy as { id: string }).id),
        created_by: actorUserId,
        name: String((legacy as { name?: string }).name ?? ''),
      },
    };
  }
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Event not found' };

  let ownerStr =
    (data as { created_by?: string | null }).created_by != null
      ? String((data as { created_by?: string | null }).created_by).trim()
      : '';

  if (!ownerStr) {
    const { error: backfillErr } = await admin
      .from('events')
      .update({ created_by: actorUserId })
      .eq('id', id)
      .is('created_by', null);
    if (!backfillErr) ownerStr = actorUserId;
    else if (isMissingCreatedByColumn(backfillErr)) {
      ownerStr = actorUserId;
    } else {
      return { ok: false, error: backfillErr.message };
    }
  }

  if (!ownerStr || ownerStr !== actorUserId) {
    return { ok: false, error: 'Forbidden: post must belong to an event you created' };
  }

  return {
    ok: true,
    event: {
      id: String((data as { id: string }).id),
      created_by: ownerStr,
      name: String((data as { name?: string }).name ?? ''),
    },
  };
}

/** Copy event targeting onto post rows when the client omitted scope fields (common on graphics upload). */
export function inheritEventScopeForPostPayload(
  eventRow: Record<string, unknown>,
  postPayload: Record<string, unknown>,
  role: string
): void {
  const r = String(role ?? '').toLowerCase();
  const has = (key: string) => {
    const v = postPayload[key];
    if (v == null) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim() !== '';
  };

  if (r === 'moderator' || r === 'editor' || r === 'admin' || r === 'super_admin') {
    if (!has('state_id') && eventRow.state_id != null) postPayload.state_id = eventRow.state_id;
  }
  if (r === 'campaign_manager' || r === 'admin' || r === 'super_admin') {
    if (!has('target_groups') && eventRow.target_groups != null) postPayload.target_groups = eventRow.target_groups;
  }
  if (r === 'admin' || r === 'super_admin' || r === 'moderator' || r === 'editor') {
    if (!has('party_id') && eventRow.party_id != null) postPayload.party_id = eventRow.party_id;
    if (!has('loksabha_id') && eventRow.loksabha_id != null) postPayload.loksabha_id = eventRow.loksabha_id;
    if (!has('assembly_id') && eventRow.assembly_id != null) postPayload.assembly_id = eventRow.assembly_id;
  }
}
