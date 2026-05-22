import { NextRequest, NextResponse } from 'next/server';
import {
  assertAdminRole,
  createServiceRoleClient,
  isAdmin,
  isCampaignManager,
  isElevatedDashboardRole,
  isModerator,
  validateAdminSession,
  type VerifiedAdminAuth,
} from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildScopedQuery } from '@/lib/rbac/scoped-query-builder';
import { canPerformMutation } from '@/lib/rbac/mutation-gateway';
import { assertEventRowEditable } from '@/lib/event-access';
import {
  normalizeGroupId,
  parseGroupIds,
  parseStateIds,
  requireCampaignManagerHasAssignedGroups,
  RbacError,
  requireGroupAssignment,
  requireModeratorHasAssignedStates,
  requireRole,
  requireScopeState,
} from '@/lib/rbac/require';
import { resolvePostEventId } from '@/lib/admin/resolvePostEventId';
import {
  assertPostEventAccessibleForPostUpload,
  inheritEventScopeForPostPayload,
  isEventsFullAdmin,
  sanitizeCampaignManagerPostScope,
} from '@/lib/event-access';
import { canAccessScope } from '@/lib/rbac/permission-engine';
import { hasConstituencyAnchor, normalizeResourceScope } from '@/lib/rbac/normalize-scope';
import { isEditor } from '@/lib/admin-gate';
import { withAudit } from '@/lib/audit/withAudit';
import {
  failPostUpload,
  formatSupabaseError,
  logPostUploadTrace,
  sanitizePayloadForDebug,
  type PostUploadTraceStep,
} from '@/lib/admin/post-upload-trace';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isMissingColumnErr(err: { message?: string } | null | undefined, columnName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column'));
}

/** Never strip event_id — analytics schema requires it when NOT NULL. */
const INSERT_STRIP_COLUMNS_ON_MISSING = ['created_by', 'status', 'scheduled_at', 'dashboard_category'] as const;

function normalizeCaptionsForInsert(captions: unknown): unknown {
  if (captions == null) return undefined;
  if (Array.isArray(captions)) return captions;
  if (typeof captions === 'string') {
    const t = captions.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t) as unknown;
      return Array.isArray(parsed) ? parsed : [t];
    } catch {
      return [t];
    }
  }
  return captions;
}

function postUploadErrorResponse(
  steps: PostUploadTraceStep[],
  step: string,
  status: number,
  message: string,
  extra?: Record<string, unknown>
) {
  const body = failPostUpload(steps, step, status, message, extra);
  return json(body, status);
}

type ScopeParse = { state_ids: number[]; group_id: string; group_ids: string[]; malformed: boolean };

function parseScopeFromInput(input: Record<string, unknown>): ScopeParse {
  const states = parseStateIds((input as any).state_id ?? (input as any).assigned_state_ids);
  const gid = normalizeGroupId((input as any).group_id) ?? '';
  const gids = parseGroupIds((input as any).target_groups ?? (input as any).group_ids);
  const rawGidProvided = (input as any).group_id != null;
  return {
    state_ids: states.ids,
    group_id: gid,
    group_ids: gids.ids,
    malformed: states.malformed || gids.malformed || (rawGidProvided && !gid),
  };
}

function validateScopePayloadShape(auth: Pick<VerifiedAdminAuth, 'role'>, input: Record<string, unknown>) {
  if (isAdmin(auth as any)) return;

  const hasStateField = Object.prototype.hasOwnProperty.call(input, 'state_id') || Object.prototype.hasOwnProperty.call(input, 'assigned_state_ids');
  const hasGroupField = Object.prototype.hasOwnProperty.call(input, 'group_id');
  const hasGroupArrayField = Object.prototype.hasOwnProperty.call(input, 'target_groups') || Object.prototype.hasOwnProperty.call(input, 'group_ids');

  if (isModerator(auth as any)) {
    if (hasGroupField || hasGroupArrayField) {
      throw new RbacError('Forbidden: moderator payload cannot contain group scope fields', 403);
    }
  }
  if (isCampaignManager(auth as any) && hasStateField) {
    const raw = (input as any).state_id ?? (input as any).assigned_state_ids;
    const parsed = parseStateIds(raw);
    if (parsed.ids.length > 0) {
      throw new RbacError('Forbidden: campaign_manager payload cannot contain state scope fields', 403);
    }
  }

  if (hasStateField) {
    const raw = (input as any).state_id ?? (input as any).assigned_state_ids;
    const parsed = parseStateIds(raw);
    if (raw != null && (parsed.malformed || parsed.ids.length === 0)) throw new RbacError('Forbidden: malformed state scope payload', 403);
  }

  if (hasGroupField) {
    const raw = (input as any).group_id;
    if (raw != null && !normalizeGroupId(raw)) throw new RbacError('Forbidden: malformed group_id payload', 403);
  }

  if (hasGroupArrayField) {
    const raw = (input as any).target_groups ?? (input as any).group_ids;
    if (raw != null && !Array.isArray(raw)) throw new RbacError('Forbidden: malformed target_groups payload', 403);
    if (Array.isArray(raw)) {
      const parsed = parseGroupIds(raw);
      if (raw.length > 0 && (parsed.malformed || parsed.ids.length === 0)) throw new RbacError('Forbidden: malformed target_groups payload', 403);
    }
  }
}

function requireNonEmptyScopeForPosts(
  auth: Pick<
    VerifiedAdminAuth,
    | 'role'
    | 'user'
    | 'assigned_state_ids'
    | 'assigned_group_ids'
    | 'assigned_party_ids'
    | 'assigned_loksabha_ids'
    | 'assigned_assembly_ids'
  >,
  scope: ScopeParse,
  payload: Record<string, unknown>
) {
  if (isAdmin(auth as any)) return;
  if (scope.malformed) throw new RbacError('Forbidden: malformed scope identifiers', 403);
  if (isModerator(auth as any)) {
    if (scope.state_ids.length === 0) throw new RbacError('Forbidden: missing state scope', 403);
    requireScopeState(scope.state_ids, auth.assigned_state_ids, 'subset');
    return;
  }
  // campaign_manager: groups and/or constituency (aligned with event targeting)
  const full = normalizeResourceScope(payload);
  if (!hasConstituencyAnchor(full)) {
    throw new RbacError('Forbidden: missing constituency scope (groups, Lok Sabha, or Assembly)', 403);
  }
  const access = canAccessScope(
    {
      id: auth.user.id,
      role: auth.role,
      assigned_state_ids: auth.assigned_state_ids ?? [],
      assigned_group_ids: auth.assigned_group_ids ?? [],
      assigned_party_ids: auth.assigned_party_ids ?? [],
      assigned_loksabha_ids: auth.assigned_loksabha_ids,
      assigned_assembly_ids: auth.assigned_assembly_ids,
    },
    full
  );
  if (!access.allowed) {
    throw new RbacError(access.denied_reason ?? 'Forbidden: outside campaign manager scope', 403);
  }
  if (scope.group_id) requireGroupAssignment(auth as any, scope.group_id);
  if (scope.group_ids.length > 0) {
    const assigned = parseGroupIds(auth.assigned_group_ids);
    if (assigned.malformed) throw new RbacError('Forbidden: malformed assigned_group_ids', 403);
    const gids = new Set(assigned.ids);
    const ok = scope.group_ids.every((g) => gids.has(g));
    if (!ok) throw new RbacError('Forbidden: outside assigned_group_ids', 403);
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'super_admin', 'moderator', 'campaign_manager', 'editor']);
    if (!isEditor(auth)) {
      requireModeratorHasAssignedStates(auth);
      requireCampaignManagerHasAssignedGroups(auth);
    }
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);
  const adminRole = isEventsFullAdmin(auth);
  if (adminRole) assertAdminRole(auth);

  const scopedUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  } as any;

  // Always scope in SQL (no fetch-all-then-filter).
  const base = admin
    .from('posts')
    .select(
      'id,title,image_url,category,dashboard_category,created_at,scheduled_at,status,deleted_at,created_by,state_id,group_id,event_id,download_count'
    )
    .order('created_at', { ascending: false })
    .limit(200) as any;
  const q = adminRole ? base : buildScopedQuery(scopedUser, base, 'posts');
  let res: any = await q;
  if (res.error && (isMissingColumnErr(res.error, 'scheduled_at') || isMissingColumnErr(res.error, 'download_count') || isMissingColumnErr(res.error, 'event_id'))) {
    const fallback = admin
      .from('posts')
      .select('id,title,image_url,category,dashboard_category,created_at,state_id,group_id')
      .order('created_at', { ascending: false })
      .limit(200) as any;
    res = adminRole ? await fallback : await buildScopedQuery(scopedUser, fallback, 'posts');
  }
  if (res.error) return json({ error: res.error.message }, 500);
  return json({ posts: res.data ?? [], usedServiceRole: true });
}

function mutationUser(auth: VerifiedAdminAuth) {
  return {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
}

async function loadEventByCategoryName(admin: NonNullable<ReturnType<typeof createServiceRoleClient>>, category: string) {
  let q = admin
    .from('events')
    .select('id,name,created_by,state_id,target_groups')
    .eq('name', category)
    .limit(1);
  q = q.is('deleted_at', null) as typeof q;
  let res = await q.maybeSingle();
  if (res.error && isMissingColumnErr(res.error, 'deleted_at')) {
    res = await admin.from('events').select('id,name,created_by,state_id,target_groups').eq('name', category).limit(1).maybeSingle();
  }
  if (res.error) return { error: res.error.message as string, event: null as Record<string, unknown> | null };
  return { error: null as string | null, event: (res.data as Record<string, unknown> | null) ?? null };
}

async function scopedPostIdsByCategory(
  admin: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  auth: VerifiedAdminAuth,
  category: string
): Promise<{ error: string | null; ids: string[] }> {
  const adminRole = isEventsFullAdmin(auth);
  const scopedUser = mutationUser(auth);
  let q = admin.from('posts').select('id').eq('category', category) as any;
  if (!adminRole) q = buildScopedQuery(scopedUser as any, q, 'posts');
  const { data, error } = await q;
  if (error) return { error: error.message, ids: [] };
  const ids = (data ?? []).map((r: { id?: unknown }) => String(r.id ?? '').trim()).filter(Boolean);
  return { error: null, ids };
}

async function guardPostsByCategory(
  admin: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  auth: VerifiedAdminAuth,
  category: string,
  action: 'posts.update' | 'posts.delete'
): Promise<NextResponse | null> {
  const { error: evErr, event } = await loadEventByCategoryName(admin, category);
  if (evErr) return json({ error: evErr }, 500);
  if (event?.id) {
    try {
      assertEventRowEditable(auth, event);
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }
    const decision = canPerformMutation(
      mutationUser(auth) as any,
      action,
      {
        created_by: event.created_by,
        state_ids: event.state_id,
        group_ids: event.target_groups,
      } as any,
      { category },
      { resourceType: 'posts', resourceId: String(event.id ?? ''), resourceName: category }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);
    return null;
  }
  const { error, ids } = await scopedPostIdsByCategory(admin, auth, category);
  if (error) return json({ error }, 500);
  if (ids.length === 0) return json({ error: 'Forbidden: no posts in scope for category' }, 403);
  const decision = canPerformMutation(
    mutationUser(auth) as any,
    action,
    { category } as any,
    { category },
    { resourceType: 'posts', resourceName: category }
  );
  if (!decision.ok) return json({ error: decision.reason }, 403);
  return null;
}

/** Bulk patch posts for an event category (events admin UI — replaces client Supabase writes). */
export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'super_admin', 'moderator', 'campaign_manager', 'editor']);
    if (!isEditor(auth)) {
      requireModeratorHasAssignedStates(auth);
      requireCampaignManagerHasAssignedGroups(auth);
    }
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  let body: { category?: string; patch?: Record<string, unknown> } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const category = String(body.category ?? '').trim();
  const patch = body.patch && typeof body.patch === 'object' ? body.patch : null;
  if (!category || !patch || Object.keys(patch).length === 0) return json({ error: 'Missing category or patch' }, 400);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const denied = await guardPostsByCategory(admin, auth, category, 'posts.update');
  if (denied) return denied;

  const { error, ids } = await scopedPostIdsByCategory(admin, auth, category);
  if (error) return json({ error }, 500);
  if (ids.length === 0) return json({ ok: true, updated: 0 });

  const { error: updErr } = await admin.from('posts').update(patch as any).in('id', ids);
  if (updErr) return json({ error: updErr.message }, 500);
  return json({ ok: true, updated: ids.length });
}

/** Delete post by id or all posts in an event category (scoped + mutation gate). */
export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'super_admin', 'moderator', 'campaign_manager', 'editor']);
    if (!isEditor(auth)) {
      requireModeratorHasAssignedStates(auth);
      requireCampaignManagerHasAssignedGroups(auth);
    }
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const sp = request.nextUrl.searchParams;
  const id = (sp.get('id') ?? '').trim();
  const category = (sp.get('category') ?? '').trim();
  if (!id && !category) return json({ error: 'Missing id or category' }, 400);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  if (id) {
    const { data: row, error: readErr } = await admin.from('posts').select('id,category,created_by,event_id,state_id,group_id,target_groups').eq('id', id).maybeSingle();
    if (readErr) return json({ error: readErr.message }, 500);
    if (!row) return json({ error: 'Not found' }, 404);
    const cat = String((row as any).category ?? '').trim();
    if (cat) {
      const denied = await guardPostsByCategory(admin, auth, cat, 'posts.delete');
      if (denied) return denied;
    } else {
      const decision = canPerformMutation(
        mutationUser(auth) as any,
        'posts.delete',
        row as any,
        null,
        { resourceType: 'posts', resourceId: id }
      );
      if (!decision.ok) return json({ error: decision.reason }, 403);
    }
    const { error: delErr } = await admin.from('posts').delete().eq('id', id);
    if (delErr) return json({ error: delErr.message }, 500);
    return json({ ok: true, deleted: 1 });
  }

  const denied = await guardPostsByCategory(admin, auth, category, 'posts.delete');
  if (denied) return denied;

  const { error, ids } = await scopedPostIdsByCategory(admin, auth, category);
  if (error) return json({ error }, 500);
  if (ids.length === 0) return json({ ok: true, deleted: 0 });

  const { error: delErr } = await admin.from('posts').delete().in('id', ids);
  if (delErr) return json({ error: delErr.message }, 500);
  return json({ ok: true, deleted: ids.length });
}

export const POST = withAudit(
  async ({ req, auth, admin }) => {
    const trace: PostUploadTraceStep[] = [];
    trace.push({
      step: 'auth',
      ok: true,
      detail: {
        user_id: auth.user.id,
        role: auth.role,
        auth_uid_matches_user_id: true,
      },
    });

    try {
      requireRole(auth, ['admin', 'super_admin', 'moderator', 'campaign_manager', 'editor']);
      if (!isEditor(auth)) {
        requireModeratorHasAssignedStates(auth);
        requireCampaignManagerHasAssignedGroups(auth);
      }
    } catch (e) {
      if (e instanceof RbacError) {
        return postUploadErrorResponse(trace, 'requireRole', e.status, e.message);
      }
      return postUploadErrorResponse(trace, 'requireRole', 403, 'Forbidden');
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return postUploadErrorResponse(trace, 'parseBody', 400, 'Invalid JSON body');
    }

    const payload: Record<string, unknown> = { ...(body ?? {}) };
    payload.created_by = auth.user.id;
    if (Object.prototype.hasOwnProperty.call(payload, 'captions')) {
      payload.captions = normalizeCaptionsForInsert(payload.captions);
    }

    const eventIdRaw = String(payload.event_id ?? '').trim();
    trace.push({ step: 'event_id_received', ok: !!eventIdRaw, detail: { event_id_raw: eventIdRaw || null } });

    const resolvedEventId = await resolvePostEventId(admin, payload);
    trace.push({
      step: 'resolvePostEventId',
      ok: !!resolvedEventId,
      detail: { resolved_event_id: resolvedEventId, category: String(payload.category ?? '') },
    });
    if (!resolvedEventId) {
      return postUploadErrorResponse(
        trace,
        'resolvePostEventId',
        400,
        'event_id is required and must reference an existing event',
        { event_id_raw: eventIdRaw }
      );
    }

    const { data: eventRowProbe, error: eventProbeErr } = await admin
      .from('events')
      .select('id, created_by, name')
      .eq('id', resolvedEventId)
      .maybeSingle();
    trace.push({
      step: 'events_row_probe',
      ok: !eventProbeErr && !!eventRowProbe,
      detail: {
        event_exists: !!eventRowProbe,
        event_created_by: (eventRowProbe as { created_by?: string | null } | null)?.created_by ?? null,
        event_created_by_is_null: (eventRowProbe as { created_by?: string | null } | null)?.created_by == null,
        supabase: formatSupabaseError(eventProbeErr),
      },
    });

    const eventAccess = await assertPostEventAccessibleForPostUpload(admin, resolvedEventId, auth);
    trace.push({
      step: 'assertPostEventAccessibleForPostUpload',
      ok: eventAccess.ok,
      detail: eventAccess.ok
        ? {
            auth_role: auth.role,
            event_id: eventAccess.event.id,
            event_created_by: eventAccess.event.created_by,
            actor_user_id: auth.user.id,
            ownership_match: eventAccess.ownership_match,
            scope_match: eventAccess.scope_match,
            access_reason: eventAccess.access_reason,
          }
        : {
            auth_role: auth.role,
            event_id: resolvedEventId,
            event_created_by: eventAccess.event_created_by ?? null,
            ownership_match: eventAccess.ownership_match ?? false,
            scope_match: eventAccess.scope_match ?? false,
            failing_rbac_step: 'assertPostEventAccessibleForPostUpload',
            reason: eventAccess.reason,
            error: eventAccess.error,
          },
    });
    if (!eventAccess.ok) {
      return postUploadErrorResponse(trace, 'assertPostEventAccessibleForPostUpload', 403, eventAccess.error, {
        reason: eventAccess.reason,
        auth_role: auth.role,
        event_id: resolvedEventId,
        event_created_by: eventAccess.event_created_by ?? null,
        ownership_match: eventAccess.ownership_match ?? false,
        scope_match: eventAccess.scope_match ?? false,
      });
    }

    payload.event_id = resolvedEventId;
    if (!String(payload.category ?? '').trim()) payload.category = eventAccess.event.name;

    const { data: eventScopeRow, error: eventScopeErr } = await admin
      .from('events')
      .select('state_id, party_id, loksabha_id, assembly_id, target_groups, created_by')
      .eq('id', resolvedEventId)
      .maybeSingle();
    if (eventScopeErr) {
      trace.push({ step: 'event_scope_fetch', ok: false, detail: { supabase: formatSupabaseError(eventScopeErr) } });
    }
    if (eventScopeRow && typeof eventScopeRow === 'object') {
      inheritEventScopeForPostPayload(eventScopeRow as Record<string, unknown>, payload, auth.role);
      if (isCampaignManager(auth)) sanitizeCampaignManagerPostScope(payload);
      trace.push({
        step: 'inheritEventScopeForPostPayload',
        ok: true,
        detail: {
          state_id: payload.state_id,
          target_groups: payload.target_groups,
          party_id: payload.party_id,
        },
      });
    }

    if (isEventsFullAdmin(auth) && !isEditor(auth)) {
      const scheduled_at_raw = body?.scheduled_at != null ? String(body.scheduled_at).trim() : '';
      const scheduled_at = scheduled_at_raw ? new Date(scheduled_at_raw).toISOString() : null;
      const nowIso = new Date().toISOString();
      if (scheduled_at && scheduled_at <= nowIso) {
        return postUploadErrorResponse(trace, 'scheduled_at', 400, 'scheduled_at must be in the future');
      }
      if (scheduled_at) {
        payload.scheduled_at = scheduled_at;
        payload.status = 'scheduled_publish';
      } else {
        payload.scheduled_at = null;
        payload.status = 'published';
      }
    } else {
      payload.scheduled_at = null;
      payload.status = 'published';
    }

    if (isCampaignManager(auth)) sanitizeCampaignManagerPostScope(payload);
    const scope = parseScopeFromInput(payload);
    try {
      if (!isEditor(auth)) {
        validateScopePayloadShape(auth as any, payload as any);
        requireNonEmptyScopeForPosts(auth as any, scope, payload);
      }
    } catch (e) {
      const msg = e instanceof RbacError ? e.message : 'Forbidden';
      trace.push({
        step: 'scope_validation',
        ok: false,
        detail: {
          auth_role: auth.role,
          event_id: resolvedEventId,
          failing_rbac_step: 'scope_validation',
          reason: msg,
          scope_state_ids: scope.state_ids,
          scope_group_ids: scope.group_ids,
        },
      });
      return postUploadErrorResponse(trace, 'scope_validation', e instanceof RbacError ? e.status : 403, msg, {
        auth_role: auth.role,
        event_id: resolvedEventId,
        failing_rbac_step: 'scope_validation',
      });
    }

    const mutationOwner =
      eventAccess.event.created_by != null ? String(eventAccess.event.created_by).trim() : auth.user.id;
    const decision = canPerformMutation(
      { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
      'posts.create',
      { created_by: mutationOwner },
      payload as any,
      { resourceType: 'posts', resourceName: String((payload as any)?.title ?? '') }
    );
    trace.push({
      step: 'canPerformMutation',
      ok: decision.ok,
      detail: {
        auth_role: auth.role,
        event_id: resolvedEventId,
        action: 'posts.create',
        mutation_owner: mutationOwner,
        ownership_match: eventAccess.ownership_match,
        scope_match: eventAccess.scope_match,
        failing_rbac_step: decision.ok ? undefined : 'canPerformMutation',
        reason: decision.ok ? undefined : decision.reason,
      },
    });
    if (!decision.ok) {
      return postUploadErrorResponse(trace, 'canPerformMutation', 403, decision.reason, {
        auth_role: auth.role,
        event_id: resolvedEventId,
        event_created_by: eventAccess.event.created_by,
        ownership_match: eventAccess.ownership_match,
        scope_match: eventAccess.scope_match,
        failing_rbac_step: 'canPerformMutation',
      });
    }

    let insertBody: Record<string, unknown> = { ...payload };
    trace.push({
      step: 'insert_payload',
      ok: true,
      detail: { payload: sanitizePayloadForDebug(insertBody) },
    });

    let insertRes = await admin.from('posts').insert(insertBody as any).select('*').single();
    trace.push({
      step: 'posts.insert_attempt_1',
      ok: !insertRes.error,
      detail: {
        supabase: formatSupabaseError(insertRes.error),
        note: 'service_role client — RLS not applied on this path',
      },
    });

    for (const col of INSERT_STRIP_COLUMNS_ON_MISSING) {
      if (insertRes.error && isMissingColumnErr(insertRes.error, col) && Object.prototype.hasOwnProperty.call(insertBody, col)) {
        const next = { ...insertBody };
        delete (next as Record<string, unknown>)[col];
        insertBody = next;
        insertRes = await admin.from('posts').insert(insertBody as any).select('*').single();
        trace.push({
          step: `posts.insert_retry_strip_${col}`,
          ok: !insertRes.error,
          detail: { stripped_column: col, supabase: formatSupabaseError(insertRes.error) },
        });
      }
    }

    if (insertRes.error && String(insertRes.error.message ?? '').toLowerCase().includes('captions')) {
      const next = { ...insertBody };
      const cap = next.captions;
      if (typeof cap === 'string') {
        try {
          next.captions = JSON.parse(cap);
        } catch {
          delete next.captions;
        }
      } else if (Array.isArray(cap)) {
        next.captions = cap;
      } else {
        delete next.captions;
      }
      insertBody = next;
      insertRes = await admin.from('posts').insert(insertBody as any).select('*').single();
      trace.push({
        step: 'posts.insert_retry_captions',
        ok: !insertRes.error,
        detail: { supabase: formatSupabaseError(insertRes.error) },
      });
    }

    if (insertRes.error) {
      return postUploadErrorResponse(trace, 'posts.insert', 500, insertRes.error.message, {
        supabase: formatSupabaseError(insertRes.error),
        final_payload: sanitizePayloadForDebug(insertBody),
      });
    }

    const insertedId = (insertRes.data as { id?: string } | null)?.id;
    if (insertedId == null || String(insertedId).trim() === '') {
      return postUploadErrorResponse(trace, 'posts.insert_no_id', 500, 'Insert succeeded but no post id returned', {
        supabase: formatSupabaseError(insertRes.error),
      });
    }

    const verifyRes = await admin
      .from('posts')
      .select('id, event_id, created_by, title, image_url')
      .eq('id', insertedId)
      .maybeSingle();
    trace.push({
      step: 'posts.verify_row',
      ok: !verifyRes.error && !!verifyRes.data,
      detail: {
        post_id: insertedId,
        row: verifyRes.data ?? null,
        supabase: formatSupabaseError(verifyRes.error),
      },
    });
    if (verifyRes.error || !verifyRes.data) {
      return postUploadErrorResponse(
        trace,
        'posts.verify_row',
        500,
        verifyRes.error?.message ?? 'Row not found in posts after insert',
        { supabase: formatSupabaseError(verifyRes.error) }
      );
    }

    logPostUploadTrace('success', trace);
    return json({ post: insertRes.data, verified: true });
  },
  {
    action_type: 'post.created',
    resource_type: 'posts',
    severity: 'info',
    undoable: true,
    build: ({ response_json }) => {
      const post = response_json?.post ?? null;
      const scheduled_at = post?.scheduled_at ?? null;
      return {
        resource_id: post?.id != null ? String(post.id) : null,
        resource_name: post?.title != null ? String(post.title) : null,
        metadata: scheduled_at ? { scheduled_at } : {},
        new_data: post,
      };
    },
  }
);

export const PATCH = withAudit(
  async ({ req, auth, admin, previous_data }) => {
    try {
      requireRole(auth, ['admin', 'super_admin', 'moderator', 'campaign_manager', 'editor']);
      if (!isEditor(auth)) {
        requireModeratorHasAssignedStates(auth);
        requireCampaignManagerHasAssignedGroups(auth);
      }
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const id = body?.id != null ? String(body.id).trim() : '';
    const patch = body?.patch && typeof body.patch === 'object' ? (body.patch as any) : null;
    if (!id || !patch) return json({ error: 'Missing id or patch' }, 400);

    const before: any = previous_data ?? null;
    if (!before) return json({ error: 'Not found' }, 404);

    let eventOwnerForMutation: string | null = null;
    if (!isEventsFullAdmin(auth)) {
      const eid = String(before?.event_id ?? '').trim();
      if (eid) {
        const access = await assertPostEventAccessibleForPostUpload(admin, eid, auth);
        if (!access.ok) {
          return json(
            {
              error: access.error,
              reason: access.reason,
              failing_rbac_step: 'assertPostEventAccessibleForPostUpload',
              auth_role: auth.role,
              event_id: eid,
              event_created_by: access.event_created_by ?? null,
              ownership_match: access.ownership_match ?? false,
              scope_match: access.scope_match ?? false,
            },
            403
          );
        }
        eventOwnerForMutation = access.event.created_by;
      }
      if (isEditor(auth)) {
        const postOwner = String(before?.created_by ?? '').trim();
        if (postOwner && postOwner !== auth.user.id) {
          return json({ error: 'Forbidden: post not owned by you', failing_rbac_step: 'post_ownership' }, 403);
        }
      }
    }

    const beforeScope = parseScopeFromInput(before as any);

    const patchInput = {
      ...before,
      ...patch,
      // Keep scheduling fields from patch, everything else merged for scope validation.
      scheduled_at: (patch as any).scheduled_at,
    } as Record<string, unknown>;
    const nextScope = parseScopeFromInput(patchInput);
    const beforeRow = { ...(before as Record<string, unknown>) };
    const patchInputScoped = { ...patchInput };
    if (isCampaignManager(auth)) {
      sanitizeCampaignManagerPostScope(beforeRow);
      sanitizeCampaignManagerPostScope(patchInputScoped);
      sanitizeCampaignManagerPostScope(patch as Record<string, unknown>);
    }

    // Enforce BOTH previous row scope and incoming payload scope (deny if scope missing/malformed).
    try {
      if (!isEditor(auth)) {
        validateScopePayloadShape(auth as any, patch as any);
        requireNonEmptyScopeForPosts(auth as any, beforeScope, beforeRow);
        requireNonEmptyScopeForPosts(auth as any, nextScope, patchInputScoped);
      }
    } catch (e) {
      if (e instanceof RbacError) {
        canPerformMutation(
          { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
          'posts.update',
          { created_by: (before as any)?.created_by, state_ids: beforeScope.state_ids, group_id: beforeScope.group_id, group_ids: beforeScope.group_ids } as any,
          patch as any,
          { resourceType: 'posts', resourceId: id, resourceName: String((before as any)?.title ?? '') }
        );
        return json({ error: e.message }, e.status);
      }
      return json({ error: 'Forbidden' }, 403);
    }

    {
      const decision = canPerformMutation(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
        'posts.update',
        {
          created_by: eventOwnerForMutation ?? (before as any)?.created_by,
          state_ids: beforeScope.state_ids,
          group_id: beforeScope.group_id,
          group_ids: beforeScope.group_ids,
        } as any,
        patch as any,
        { resourceType: 'posts', resourceId: id, resourceName: String((before as any)?.title ?? '') }
      );
      if (!decision.ok) return json({ error: decision.reason }, 403);
    }

    // Scheduling logic
    const scheduled_at_raw = patch?.scheduled_at != null ? String(patch.scheduled_at).trim() : '';
    const scheduled_at = scheduled_at_raw ? new Date(scheduled_at_raw).toISOString() : null;
    const nowIso = new Date().toISOString();
    if (scheduled_at && scheduled_at <= nowIso) return json({ error: 'scheduled_at must be in the future' }, 400);

    const nextPatch: any = { ...patch };
    if ('scheduled_at' in patch) {
      nextPatch.scheduled_at = scheduled_at;
      nextPatch.status = scheduled_at ? 'scheduled_publish' : 'published';
    }

    // Prevent non-admin from changing ownership
    if (!isElevatedDashboardRole(auth.role)) delete nextPatch.created_by;
    // Prevent non-admin from writing malformed scope payload.
    if (!isElevatedDashboardRole(auth.role)) {
      if (nextScope.state_ids.length > 0) nextPatch.state_id = nextScope.state_ids;
      if (nextScope.group_id) nextPatch.group_id = nextScope.group_id;
      if (nextScope.group_ids.length > 0) nextPatch.target_groups = nextScope.group_ids;
    }

    const resolvedEventId = await resolvePostEventId(admin, { ...before, ...nextPatch });
    if (resolvedEventId) {
      if (!isEventsFullAdmin(auth)) {
        const access = await assertPostEventAccessibleForPostUpload(admin, resolvedEventId, auth);
        if (!access.ok) {
          return json(
            {
              error: access.error,
              reason: access.reason,
              failing_rbac_step: 'assertPostEventAccessibleForPostUpload',
              auth_role: auth.role,
              event_id: resolvedEventId,
              ownership_match: access.ownership_match ?? false,
              scope_match: access.scope_match ?? false,
            },
            403
          );
        }
      }
      nextPatch.event_id = resolvedEventId;
    }

    const { data, error } = await admin.from('posts').update(nextPatch).eq('id', id).select('*').single();
    if (error) return json({ error: error.message }, 500);
    return json({ post: data });
  },
  {
    action_type: 'post.updated',
    resource_type: 'posts',
    severity: 'info',
    undoable: true,
    getPreviousData: async ({ req, admin }) => {
      const body = (await req.clone().json().catch(() => ({}))) as any;
      const id = body?.id != null ? String(body.id).trim() : '';
      if (!id) return null as any;
      const { data } = await admin.from('posts').select('*').eq('id', id).maybeSingle();
      return data as any;
    },
    build: ({ response_json, previous_data }) => {
      const post = response_json?.post ?? null;
      const before = previous_data as any;
      const beforeStatus = String(before?.status ?? '');
      const afterStatus = String(post?.status ?? '');
      const action_type =
        beforeStatus !== afterStatus && afterStatus === 'scheduled_publish'
          ? 'post.scheduled_publish'
          : beforeStatus !== afterStatus && afterStatus === 'published' && beforeStatus === 'scheduled_publish'
            ? 'post.published_now'
            : 'post.updated';
      return {
        action_type,
        resource_id: post?.id != null ? String(post.id) : null,
        resource_name: post?.title != null ? String(post.title) : null,
        metadata: post?.scheduled_at ? { scheduled_at: post.scheduled_at } : {},
        new_data: post,
      };
    },
  }
);

