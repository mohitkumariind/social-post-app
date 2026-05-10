import { NextRequest, NextResponse } from 'next/server';
import {
  assertAdminRole,
  createServiceRoleClient,
  isAdmin,
  isCampaignManager,
  isModerator,
  validateAdminSession,
} from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { buildScopedQuery, resolveEffectiveGroupIdsForCampaignManager } from '@/lib/rbac/scoped-query-builder';
import { canPerformMutation } from '@/lib/rbac/scoped-write-engine';
import {
  RbacError,
  requireModeratorHasAssignedStates,
  requireOwnership,
  requireRole,
  requireScopeState,
  toNumArray,
} from '@/lib/rbac/require';
import { API_DEFAULT_LIMIT, API_MAX_LIMIT, clampLimit } from '@/lib/perf-defaults';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function parseFutureScheduledAt(input: unknown): { scheduled_at: string | null; shouldSchedule: boolean } | { error: string } {
  if (input == null || String(input).trim() === '') return { scheduled_at: null, shouldSchedule: false };
  const iso = new Date(String(input)).toISOString();
  const nowIso = new Date().toISOString();
  if (iso <= nowIso) return { error: 'scheduled_at must be in the future' };
  return { scheduled_at: iso, shouldSchedule: true };
}

function isMissingColumnErr(err: { message?: string } | null | undefined, columnName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column') || msg.includes('schema cache'));
}

/** PostgREST rejects the whole projection if any listed column is missing. */
function stripColumnFromSelect(selectList: string, column: string): string {
  const col = column.trim().toLowerCase();
  const t = selectList.trim();
  if (t === '*') return '*';
  const parts = t.split(',').map((s) => s.trim()).filter(Boolean);
  const filtered = parts.filter((p) => p.split(/\s+/)[0]!.toLowerCase() !== col);
  return filtered.length ? filtered.join(', ') : 'id';
}

type ServiceDb = NonNullable<ReturnType<typeof createServiceRoleClient>>;

async function selectEventByIdMaybe(db: ServiceDb, id: string, selectList: string) {
  let { data, error } = await db.from('events').select(selectList).eq('id', id).maybeSingle();
  if (error && isMissingColumnErr(error, 'created_by')) {
    const legacy = stripColumnFromSelect(selectList, 'created_by');
    ({ data, error } = await db.from('events').select(legacy).eq('id', id).maybeSingle());
  }
  return { data, error };
}

function hasStoredCreatedBy(row: unknown): boolean {
  const v = (row as any)?.created_by;
  return v != null && String(v).trim() !== '';
}

function parseMissingColumnName(err: { message?: string } | null | undefined): string | null {
  const msg = String(err?.message ?? '');
  // Supabase PostgREST schema cache error commonly looks like:
  // "Could not find the 'created_by' column of 'events' in the schema cache"
  const m = msg.match(/Could not find the '([^']+)' column/i);
  return m && m[1] ? String(m[1]).trim() : null;
}

async function resolveCmEffectiveGroupsOrError(
  db: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  auth: { user: { id: string }; role: 'admin' | 'moderator' | 'campaign_manager'; assigned_group_ids: string[] }
): Promise<{ error: ReturnType<typeof json> | null; ids: string[] | undefined }> {
  if (!isCampaignManager(auth)) return { error: null, ids: undefined };
  const eff = await resolveEffectiveGroupIdsForCampaignManager(db, auth.user.id, auth.assigned_group_ids);
  if (eff === null) return { error: json({ error: 'Unable to resolve group assignments' }, 500), ids: undefined };
  if (eff.length === 0) return { error: json({ error: 'Campaign manager is missing assigned_group_ids' }, 403), ids: undefined };
  return { error: null, ids: eff };
}

function rbacUserForMutation(
  auth: { user: { id: string }; role: 'admin' | 'moderator' | 'campaign_manager'; assigned_state_ids: number[]; assigned_group_ids: string[] },
  cmEffective?: string[]
) {
  return {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: isCampaignManager(auth) && cmEffective && cmEffective.length > 0 ? cmEffective : auth.assigned_group_ids,
  } as const;
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return json({ error: 'Admin event access requires SUPABASE_SERVICE_ROLE_KEY' }, 503);
  }
  const db = admin;
  const adminRole = isAdmin(auth);
  if (adminRole) assertAdminRole(auth);

  let cmEffectiveGroupIds: string[] | undefined;
  if (isCampaignManager(auth)) {
    const eff = await resolveEffectiveGroupIdsForCampaignManager(db, auth.user.id, auth.assigned_group_ids);
    if (eff === null) return json({ error: 'Unable to resolve group assignments' }, 500);
    if (eff.length === 0) return json({ error: 'Campaign manager is missing assigned_group_ids' }, 403);
    cmEffectiveGroupIds = eff;
  }

  const accessUser = () =>
    isCampaignManager(auth) && cmEffectiveGroupIds && cmEffectiveGroupIds.length > 0
      ? {
          id: auth.user.id,
          role: auth.role,
          assigned_state_ids: auth.assigned_state_ids,
          assigned_group_ids: cmEffectiveGroupIds,
        }
      : {
          id: auth.user.id,
          role: auth.role,
          assigned_state_ids: auth.assigned_state_ids,
          assigned_group_ids: auth.assigned_group_ids,
        };

  const eventsScopeCtx =
    isCampaignManager(auth) && cmEffectiveGroupIds ? { effective_group_ids: cmEffectiveGroupIds } : {};

  const id = (request.nextUrl.searchParams.get('id') ?? '').trim();
  const name = (request.nextUrl.searchParams.get('name') ?? '').trim();
  const limit = clampLimit(request.nextUrl.searchParams.get('limit'), API_DEFAULT_LIMIT, API_MAX_LIMIT);
  const cursorCreatedAt = (request.nextUrl.searchParams.get('cursor_created_at') ?? '').trim();

  const includeDeleted = (request.nextUrl.searchParams.get('include_deleted') ?? '').trim() === '1';

  // Detail fetch (used by admin UI for secure reads).
  if (id || name) {
    let q: any = db.from('events').select('*').limit(1);
    q = id ? q.eq('id', id) : q.eq('name', name);
    if (!includeDeleted) q = q.is('deleted_at', null);
    let { data, error } = await q.maybeSingle();
    if (error && isMissingColumnErr(error, 'deleted_at')) {
      // Backward compatible: older schema may not have soft-delete columns yet.
      let q2: any = db.from('events').select('*').limit(1);
      q2 = id ? q2.eq('id', id) : q2.eq('name', name);
      ({ data, error } = await q2.maybeSingle());
    }
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: 'Not found' }, 404);

    try {
      const ok = canAccessResource(
        accessUser() as any,
        {
          created_by: (data as any).created_by,
          state_ids: (data as any).state_id,
          group_ids: (data as any).target_groups,
        },
        {
          resourceType: 'events',
          audit: {
            resourceType: 'events',
            action: 'events.read',
            resourceId: String((data as any).id ?? ''),
            resourceName: String((data as any).name ?? ''),
          },
        }
      );
      if (!ok) throw new RbacError('Forbidden', 403);
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    return json({ event: data, usedServiceRole: !!admin });
  }

  // Listing
  const applyScope = (qIn: any) =>
    adminRole
      ? qIn
      : buildScopedQuery(
          { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
          qIn,
          'events',
          eventsScopeCtx
        );

  // Primary: created_at cursor pagination (preferred).
  let q: any = db.from('events').select('*').order('created_at', { ascending: false }).limit(limit);
  if (!includeDeleted) q = q.is('deleted_at', null);
  if (cursorCreatedAt) q = q.lt('created_at', cursorCreatedAt);
  q = applyScope(q);

  let { data, error } = await q;

  // Backward compatible fallbacks: missing created_at / deleted_at columns.
  if (error && isMissingColumnErr(error, 'deleted_at')) {
    let q2: any = db.from('events').select('*').order('created_at', { ascending: false }).limit(limit);
    if (cursorCreatedAt) q2 = q2.lt('created_at', cursorCreatedAt);
    q2 = applyScope(q2);
    ({ data, error } = await q2);
  }
  if (error && isMissingColumnErr(error, 'created_at')) {
    let q3: any = db.from('events').select('*').order('id', { ascending: false }).limit(limit);
    // cursor_created_at is ignored in this compatibility mode.
    if (!includeDeleted) q3 = q3.is('deleted_at', null);
    q3 = applyScope(q3);
    ({ data, error } = await q3);
    if (error && isMissingColumnErr(error, 'deleted_at')) {
      let q4: any = db.from('events').select('*').order('id', { ascending: false }).limit(limit);
      q4 = applyScope(q4);
      ({ data, error } = await q4);
    }
  }

  if (error) return json({ error: error.message }, 500);
  const rows = (data ?? []) as any[];
  const next_cursor_created_at = rows.length > 0 ? String((rows[rows.length - 1] as any)?.created_at ?? '') : '';
  return json({ events: rows, usedServiceRole: !!admin, next_cursor_created_at, limit });
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);
  {
    const { error: cmErr, ids: cmEff } = await resolveCmEffectiveGroupsOrError(admin, auth);
    if (cmErr) return cmErr;
    const decision = canPerformMutation(
      rbacUserForMutation(auth, cmEff) as any,
      'events.create',
      null,
      payload,
      { resourceType: 'events', resourceName: String((payload as any).name ?? '') }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);
  }

  if (isModerator(auth)) {
    const stateIds = toNumArray(payload.state_id);
    if (stateIds.length === 0) {
      return json({ error: 'Forbidden: moderator event must target at least one state' }, 403);
    }
    try {
      requireScopeState(stateIds, auth.assigned_state_ids, 'subset');
    } catch {
      return json({ error: 'Forbidden: event includes states outside assignment' }, 403);
    }
    const tg = Array.isArray(payload.target_groups) ? payload.target_groups : [];
    if (tg.length > 0) {
      return json({ error: 'Forbidden: moderators cannot create target_groups events' }, 403);
    }
  }

  if (isCampaignManager(auth)) {
    const tg = Array.isArray(payload.target_groups) ? payload.target_groups : [];
    if (tg.length === 0) return json({ error: 'Forbidden: campaign_manager must target_groups' }, 403);
    // No global/state-wide targeting for campaign_manager.
    const forbiddenKeys = ['party', 'state', 'loksabha', 'assembly', 'party_id', 'state_id', 'loksabha_id', 'assembly_id', 'profile_ids', 'group_id'];
    for (const k of forbiddenKeys) {
      if (payload[k] != null && Array.isArray(payload[k]) ? (payload[k] as any[]).length > 0 : !!payload[k]) {
        return json({ error: `Forbidden: campaign_manager cannot target ${k}` }, 403);
      }
    }
  }

  // Always set owner on creation (admin + moderator).
  payload.created_by = auth.user.id;

  // Scheduled publishing: store scheduled_at, set status.
  const schedParsed = parseFutureScheduledAt((payload as any).scheduled_at);
  if ('error' in schedParsed) return json({ error: schedParsed.error }, 400);
  (payload as any).scheduled_at = schedParsed.scheduled_at;
  if (schedParsed.shouldSchedule) {
    (payload as any).status = 'scheduled_publish';
    (payload as any).published_at = null;
    (payload as any).published_by = null;
  } else {
    (payload as any).status = 'published';
    (payload as any).published_at = new Date().toISOString();
    (payload as any).published_by = auth.user.id;
  }

  // Best-effort compatibility for schema cache lag / partial migrations:
  // retry inserts while stripping unknown columns indicated by PostgREST.
  // Never strip RBAC / scope columns on retry — partial inserts (e.g. missing target_groups) become invisible in scoped listings.
  const requiredKeys = new Set(['name', 'start', 'end', 'target_groups', 'state_id', 'created_by']);
  let insertPayload: Record<string, unknown> = { ...payload };
  let insertRes = await admin.from('events').insert(insertPayload).select().single();
  for (let attempts = 0; attempts < 10 && insertRes.error; attempts++) {
    const missing = parseMissingColumnName(insertRes.error as any);
    if (!missing) break;
    if (requiredKeys.has(missing)) break;
    if (!Object.prototype.hasOwnProperty.call(insertPayload, missing)) break;
    delete (insertPayload as any)[missing];
    insertRes = await admin.from('events').insert(insertPayload as any).select().single();
  }

  if (insertRes.error) return json({ error: insertRes.error.message }, 500);
  const data = insertRes.data as any;

  void logAdminAction({
    actor_user_id: auth.user.id,
    actor_role: auth.role,
    action_type: 'event.created',
    resource_type: 'events',
    resource_id: String((data as any)?.id ?? ''),
    resource_name: String((data as any)?.name ?? ''),
    previous_data: null,
    new_data: data,
    severity: 'info',
    undoable: true,
    scope_state_ids: toNumArray((data as any)?.state_id),
    metadata: (data as any)?.scheduled_at ? { scheduled_at: (data as any).scheduled_at } : {},
  });

  return json({ event: data });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  let body: { id?: string | number; patch?: Record<string, unknown> } = {};
  try {
    body = (await request.json()) as any;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const id = body.id != null ? String(body.id).trim() : '';
  const patch = body.patch && typeof body.patch === 'object' ? body.patch : null;
  if (!id || !patch) return json({ error: 'Missing id or patch' }, 400);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);
  const { error: cmErr, ids: cmEff } = await resolveCmEffectiveGroupsOrError(admin, auth);
  if (cmErr) return cmErr;

  // Pre-read minimal resource for write guard
  const { data: evForGuard, error: evForGuardErr } = await selectEventByIdMaybe(
    admin,
    id,
    'id, created_by, state_id, target_groups, name'
  );
  if (evForGuardErr) return json({ error: evForGuardErr.message }, 500);
  {
    const decision = canPerformMutation(
      rbacUserForMutation(auth, cmEff) as any,
      'events.update',
      {
        created_by: (evForGuard as any)?.created_by,
        state_ids: (evForGuard as any)?.state_id,
        group_ids: (evForGuard as any)?.target_groups,
      },
      patch as any,
      { resourceType: 'events', resourceId: id, resourceName: String((evForGuard as any)?.name ?? '') }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);
  }

  if (isModerator(auth)) {
    try {
      if (hasStoredCreatedBy(evForGuard)) {
        requireOwnership((evForGuard as any)?.created_by, auth.user.id);
      }
      requireScopeState((evForGuard as any)?.state_id, auth.assigned_state_ids, 'subset');
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }
    const existingStateIds = toNumArray((evForGuard as any)?.state_id);
    const nextStateIds = patch.state_id != null ? toNumArray(patch.state_id) : existingStateIds;
    try {
      requireScopeState(nextStateIds, auth.assigned_state_ids, 'subset');
    } catch {
      return json({ error: 'Forbidden: cannot set states outside assignment' }, 403);
    }
    const nextTargetGroups = patch.target_groups != null ? (Array.isArray(patch.target_groups) ? patch.target_groups : []) : ((evForGuard as any)?.target_groups ?? []);
    if (Array.isArray(nextTargetGroups) && nextTargetGroups.length > 0) return json({ error: 'Forbidden: moderators cannot use target_groups events' }, 403);

    // Never allow moderators to change ownership.
    if (patch.created_by != null) return json({ error: 'Forbidden' }, 403);
  }

  if (isCampaignManager(auth)) {
    try {
      if (hasStoredCreatedBy(evForGuard)) {
        requireOwnership((evForGuard as any)?.created_by, auth.user.id);
      }
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    // Must remain groups-only targeting.
    if (patch.target_groups != null) {
      const tg = Array.isArray(patch.target_groups) ? patch.target_groups : [];
      if (tg.length === 0) return json({ error: 'Forbidden: campaign_manager must target_groups' }, 403);
    }

    const forbiddenKeys = ['party', 'state', 'loksabha', 'assembly', 'party_id', 'state_id', 'loksabha_id', 'assembly_id', 'profile_ids', 'group_id'];
    for (const k of forbiddenKeys) {
      if (patch[k] != null && Array.isArray(patch[k]) ? (patch[k] as any[]).length > 0 : !!patch[k]) {
        return json({ error: `Forbidden: campaign_manager cannot target ${k}` }, 403);
      }
    }

    if (patch.created_by != null) return json({ error: 'Forbidden' }, 403);
  }

  const { data: before, error: beforeErr } = await admin.from('events').select('*').eq('id', id).maybeSingle();
  if (beforeErr) return json({ error: beforeErr.message }, 500);
  if (!before) return json({ error: 'Not found' }, 404);
  if ((before as any).deleted_at != null) return json({ error: 'Not found' }, 404);

  // Scheduled publishing input: if scheduled_at is explicitly provided, apply schedule rules.
  if (Object.prototype.hasOwnProperty.call(patch, 'scheduled_at')) {
    const v = (patch as any).scheduled_at;
    if (v == null || String(v).trim() === '') {
      // Publish now: clear schedule and publish immediately.
      (patch as any).scheduled_at = null;
      (patch as any).status = 'published';
      (patch as any).published_at = new Date().toISOString();
      (patch as any).published_by = auth.user.id;
    } else {
      const parsed = parseFutureScheduledAt(v);
      if ('error' in parsed) return json({ error: parsed.error }, 400);
      (patch as any).scheduled_at = parsed.scheduled_at;
      (patch as any).status = 'scheduled_publish';
      (patch as any).published_at = null;
      (patch as any).published_by = null;
    }
  }

  // Workflow guards + server-stamped timestamps (publish/archive/unpublish)
  const requestedStatus = patch.status != null ? String(patch.status).trim() : '';
  if (requestedStatus) {
    if (requestedStatus === 'published') {
      if (String((before as any).status ?? '') === 'published' && (before as any).published_at != null) {
        return json({ error: 'Already published' }, 409);
      }
      patch.status = 'published';
      patch.published_at = new Date().toISOString();
      patch.published_by = auth.user.id;
      patch.archived_at = null;
      patch.archived_by = null;
    } else if (requestedStatus === 'archived') {
      patch.status = 'archived';
      patch.archived_at = new Date().toISOString();
      patch.archived_by = auth.user.id;
    } else if (requestedStatus === 'draft') {
      patch.status = 'draft';
      patch.published_at = null;
      patch.published_by = null;
      patch.archived_at = null;
      patch.archived_by = null;
    } else if (requestedStatus === 'scheduled_publish') {
      patch.status = 'scheduled_publish';
      // published_at/published_by remain null until publish happens.
    } else {
      return json({ error: 'Invalid status' }, 400);
    }
  }

  const { data, error } = await admin.from('events').update(patch).eq('id', id).select().single();
  if (error) return json({ error: error.message }, 500);

  const beforeStatus = String((before as any).status ?? '').trim();
  const afterStatus = String((data as any).status ?? '').trim();
  const actionType =
    beforeStatus !== afterStatus && afterStatus === 'published'
      ? 'event.published'
      : beforeStatus !== afterStatus && afterStatus === 'archived'
        ? 'event.archived'
        : beforeStatus !== afterStatus && afterStatus === 'draft'
          ? 'event.unpublished'
          : beforeStatus !== afterStatus && afterStatus === 'scheduled_publish'
            ? 'event.scheduled_publish'
            : 'event.updated';

  void logAdminAction({
    actor_user_id: auth.user.id,
    actor_role: auth.role,
    action_type: actionType,
    resource_type: 'events',
    resource_id: String((data as any)?.id ?? id),
    resource_name: String((data as any)?.name ?? ''),
    previous_data: before,
    new_data: data,
    severity: 'info',
    undoable: true,
    scope_state_ids: toNumArray((data as any)?.state_id ?? (before as any)?.state_id),
    metadata: (data as any)?.scheduled_at ? { scheduled_at: (data as any).scheduled_at } : {},
  });

  return json({ event: data });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const id = (request.nextUrl.searchParams.get('id') ?? '').trim();
  if (!id) return json({ error: 'Missing id' }, 400);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);
  const { error: cmErr, ids: cmEff } = await resolveCmEffectiveGroupsOrError(admin, auth);
  if (cmErr) return cmErr;

  const { data: evForGuard, error: evForGuardErr } = await selectEventByIdMaybe(
    admin,
    id,
    'id, created_by, state_id, target_groups, name'
  );
  if (evForGuardErr) return json({ error: evForGuardErr.message }, 500);
  {
    const decision = canPerformMutation(
      rbacUserForMutation(auth, cmEff) as any,
      'events.delete',
      {
        created_by: (evForGuard as any)?.created_by,
        state_ids: (evForGuard as any)?.state_id,
        group_ids: (evForGuard as any)?.target_groups,
      },
      null,
      { resourceType: 'events', resourceId: id, resourceName: String((evForGuard as any)?.name ?? '') }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);
  }

  if (isModerator(auth)) {
    try {
      if (hasStoredCreatedBy(evForGuard)) {
        requireOwnership((evForGuard as any)?.created_by, auth.user.id);
      }
      requireScopeState((evForGuard as any)?.state_id, auth.assigned_state_ids, 'subset');
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }
  }

  if (isCampaignManager(auth)) {
    try {
      if (hasStoredCreatedBy(evForGuard)) {
        requireOwnership((evForGuard as any)?.created_by, auth.user.id);
      }
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }
  }

  const { data: before, error: beforeErr } = await admin.from('events').select('*').eq('id', id).maybeSingle();
  if (beforeErr) return json({ error: beforeErr.message }, 500);
  if (!before) return json({ error: 'Not found' }, 404);
  if ((before as any).deleted_at != null) return json({ ok: true, alreadyDeleted: true });

  const patch = { deleted_at: new Date().toISOString(), deleted_by: auth.user.id, status: 'archived' };
  const { data, error } = await admin.from('events').update(patch).eq('id', id).select().single();
  if (error) return json({ error: error.message }, 500);

  void logAdminAction({
    actor_user_id: auth.user.id,
    actor_role: auth.role,
    action_type: 'events.delete',
    resource_type: 'events',
    resource_id: String((data as any)?.id ?? id),
    resource_name: String((data as any)?.name ?? ''),
    previous_data: before,
    new_data: data,
    severity: 'warning',
    undoable: true,
    scope_state_ids: toNumArray((data as any)?.state_id ?? (before as any)?.state_id),
  });

  return json({ ok: true });
}

