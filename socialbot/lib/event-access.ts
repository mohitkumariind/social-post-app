import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';
import { isAdmin, isCampaignManager, isEditor, isModerator, isSuperAdmin } from '@/lib/permissions';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { RbacError } from '@/lib/rbac/require';
import { isActiveEventDashboardCategory } from '@/lib/dashboard-event-category';
import { validateEditorPartyScope } from '@/lib/admin/editor-party-scope';
import { finalizeEditorEventTargetingPayload } from '@/lib/admin/editor-event-targeting';

export function isEventsFullAdmin(auth: Pick<VerifiedAdminAuth, 'role'>): boolean {
  return isAdmin(auth.role) || isSuperAdmin(auth.role);
}

/** List/detail scope: admin sees all; everyone else sees only own events. */
export function applyEventsOwnershipScope<T extends { eq: (col: string, val: string) => T }>(
  auth: Pick<VerifiedAdminAuth, 'role' | 'user'>,
  query: T
): T {
  if (isEventsFullAdmin(auth)) return query;
  return query.eq('created_by', auth.user.id);
}

export function assertEventRowReadable(
  auth: Pick<VerifiedAdminAuth, 'role' | 'user'>,
  row: { created_by?: string | null }
): void {
  if (isEventsFullAdmin(auth)) return;
  const owner = row.created_by != null ? String(row.created_by).trim() : '';
  if (!owner || owner !== auth.user.id) {
    throw new RbacError('Forbidden: event not owned by you', 403);
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
  auth: Pick<VerifiedAdminAuth, 'role' | 'user' | 'assigned_state_ids' | 'assigned_group_ids'>
): Promise<PostEventAccessOk | PostEventAccessFail> {
  const id = String(eventId ?? '').trim();
  const actorId = String(auth.user.id).trim();
  if (!id) {
    return { ok: false, error: 'event_id is required', reason: 'missing_event_id' };
  }

  if (isAdmin(auth.role) || isSuperAdmin(auth.role)) {
    const { data, error } = await admin.from('events').select('id, created_by, name').eq('id', id).maybeSingle();
    if (error) return { ok: false, error: error.message, reason: 'event_lookup_error' };
    if (!data) return { ok: false, error: 'Event not found', reason: 'event_not_found' };
    const owner = (data as { created_by?: string | null }).created_by;
    logPostEventAccess('admin_allow', {
      auth_role: auth.role,
      event_id: id,
      event_created_by: owner ?? null,
      ownership_match: true,
      scope_match: true,
    });
    return {
      ok: true,
      event: {
        id: String((data as { id: string }).id),
        created_by: owner != null ? String(owner).trim() : null,
        name: String((data as { name?: string }).name ?? ''),
      },
      ownership_match: true,
      scope_match: true,
      access_reason: 'admin_unrestricted',
    };
  }

  let selectCols = 'id, created_by, name, state_id, target_groups';
  let { data, error } = await admin.from('events').select(selectCols).eq('id', id).maybeSingle();
  if (error && isMissingCreatedByColumn(error)) {
    selectCols = 'id, name, state_id, target_groups';
    ({ data, error } = await admin.from('events').select(selectCols).eq('id', id).maybeSingle());
  }
  if (error) return { ok: false, error: error.message, reason: 'event_lookup_error' };
  if (!data) return { ok: false, error: 'Event not found', reason: 'event_not_found' };

  let ownerStr =
    (data as { created_by?: string | null }).created_by != null
      ? String((data as { created_by?: string | null }).created_by).trim()
      : '';

  if (!ownerStr) {
    const { error: backfillErr } = await admin
      .from('events')
      .update({ created_by: actorId })
      .eq('id', id)
      .is('created_by', null);
    if (!backfillErr) ownerStr = actorId;
    else if (isMissingCreatedByColumn(backfillErr)) ownerStr = actorId;
    else return { ok: false, error: backfillErr.message, reason: 'created_by_backfill_failed' };
  }

  const ownership_match = ownerStr.length > 0 && ownerStr === actorId;
  const rbacUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids ?? [],
  };

  const baseLog = {
    auth_role: auth.role,
    event_id: id,
    event_created_by: ownerStr || null,
    ownership_match,
  };

  if (isEditor(auth.role)) {
    if (!ownership_match) {
      logPostEventAccess('editor_denied', { ...baseLog, scope_match: false, reason: 'editor_event_not_owned' });
      return {
        ok: false,
        error: 'Forbidden: post must belong to an event you created',
        reason: 'editor_event_not_owned',
        event_created_by: ownerStr || null,
        ownership_match: false,
        scope_match: false,
      };
    }
    logPostEventAccess('editor_allow', { ...baseLog, scope_match: true, access_reason: 'editor_ownership' });
    return {
      ok: true,
      event: { id, created_by: ownerStr, name: String((data as { name?: string }).name ?? '') },
      ownership_match: true,
      scope_match: true,
      access_reason: 'editor_ownership',
    };
  }

  if (isModerator(auth.role)) {
    if (ownership_match) {
      logPostEventAccess('moderator_allow', { ...baseLog, scope_match: true, access_reason: 'moderator_ownership' });
      return {
        ok: true,
        event: { id, created_by: ownerStr, name: String((data as { name?: string }).name ?? '') },
        ownership_match: true,
        scope_match: true,
        access_reason: 'moderator_ownership',
      };
    }
    const scope_match = canAccessResource(
      rbacUser,
      { state_ids: (data as { state_id?: unknown }).state_id },
      { resourceType: 'events', allowOwnershipFallback: false, audit: { resourceType: 'events', action: 'posts.upload.event.scope' } }
    );
    if (scope_match) {
      logPostEventAccess('moderator_allow', { ...baseLog, scope_match: true, access_reason: 'moderator_state_scope' });
      return {
        ok: true,
        event: { id, created_by: ownerStr, name: String((data as { name?: string }).name ?? '') },
        ownership_match: false,
        scope_match: true,
        access_reason: 'moderator_state_scope',
      };
    }
    logPostEventAccess('moderator_denied', { ...baseLog, scope_match: false, reason: 'moderator_event_scope_denied' });
    return {
      ok: false,
      error: 'Forbidden: event outside moderator assigned states',
      reason: 'moderator_event_scope_denied',
      event_created_by: ownerStr || null,
      ownership_match: false,
      scope_match: false,
    };
  }

  if (isCampaignManager(auth.role)) {
    if (ownership_match) {
      logPostEventAccess('campaign_manager_allow', {
        ...baseLog,
        scope_match: true,
        access_reason: 'campaign_manager_ownership',
      });
      return {
        ok: true,
        event: { id, created_by: ownerStr, name: String((data as { name?: string }).name ?? '') },
        ownership_match: true,
        scope_match: true,
        access_reason: 'campaign_manager_ownership',
      };
    }
    const scope_match = canAccessResource(
      rbacUser,
      { group_ids: (data as { target_groups?: unknown }).target_groups, created_by: ownerStr },
      { resourceType: 'events', allowOwnershipFallback: false, audit: { resourceType: 'events', action: 'posts.upload.event.scope' } }
    );
    if (scope_match) {
      logPostEventAccess('campaign_manager_allow', {
        ...baseLog,
        scope_match: true,
        access_reason: 'campaign_manager_group_scope',
      });
      return {
        ok: true,
        event: { id, created_by: ownerStr, name: String((data as { name?: string }).name ?? '') },
        ownership_match: false,
        scope_match: true,
        access_reason: 'campaign_manager_group_scope',
      };
    }
    logPostEventAccess('campaign_manager_denied', {
      ...baseLog,
      scope_match: false,
      reason: 'campaign_manager_event_scope_denied',
    });
    return {
      ok: false,
      error: 'Forbidden: event outside campaign_manager assigned groups',
      reason: 'campaign_manager_event_scope_denied',
      event_created_by: ownerStr || null,
      ownership_match: false,
      scope_match: false,
    };
  }

  logPostEventAccess('denied', { ...baseLog, reason: 'role_not_allowed_for_post_upload' });
  return { ok: false, error: 'Forbidden: role cannot upload posts for this event', reason: 'role_not_allowed' };
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
