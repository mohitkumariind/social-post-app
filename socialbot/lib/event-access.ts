import type { SupabaseClient } from '@supabase/supabase-js';
import type { VerifiedAdminAuth } from '@/lib/admin-gate';
import { isAdmin, isSuperAdmin } from '@/lib/permissions';
import { RbacError } from '@/lib/rbac/require';
import { isActiveEventDashboardCategory } from '@/lib/dashboard-event-category';

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

/** Editor: require ≥1 state, optional Lok Sabha/Assembly; forbid global/party/group publish fields. */
export function validateEditorEventPayload(
  payload: Record<string, unknown>,
  mode: 'create' | 'patch',
  assignedStateIds: number[] = []
): string | null {
  if (Object.prototype.hasOwnProperty.call(payload, 'dashboard_category')) {
    const dc = payload.dashboard_category;
    if (dc != null && dc !== '' && isActiveEventDashboardCategory(dc)) {
      return 'Forbidden: editor cannot create global dashboard category events';
    }
    (payload as { dashboard_category?: unknown }).dashboard_category = null;
  }

  const forbidden = [
    'party',
    'state',
    'party_id',
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
    (payload as { loksabha_id: number[] }).loksabha_id = lokIds;
    delete (payload as { loksabha?: unknown }).loksabha;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'assembly_id')) {
    const asmIds = toNumArray(payload.assembly_id);
    (payload as { assembly_id: number[] }).assembly_id = asmIds;
    delete (payload as { assembly?: unknown }).assembly;
  }

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
