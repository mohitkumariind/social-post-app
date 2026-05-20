import { NextRequest, NextResponse } from 'next/server';
import {
  assertAdminRole,
  createServiceRoleClient,
  isAdmin,
  isCampaignManager,
  isModerator,
  validateAdminSession,
  type VerifiedAdminAuth,
} from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { buildScopedQuery } from '@/lib/rbac/scoped-query-builder';
import { canPerformMutation } from '@/lib/rbac/scoped-write-engine';
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
import { withAudit } from '@/lib/audit/withAudit';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isMissingColumnErr(err: { message?: string } | null | undefined, columnName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column'));
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
  if (isCampaignManager(auth as any)) {
    if (hasStateField) {
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
  auth: Pick<VerifiedAdminAuth, 'role' | 'assigned_state_ids' | 'assigned_group_ids'>,
  scope: ScopeParse
) {
  if (isAdmin(auth as any)) return;
  if (scope.malformed) throw new RbacError('Forbidden: malformed scope identifiers', 403);
  if (isModerator(auth as any)) {
    if (scope.state_ids.length === 0) throw new RbacError('Forbidden: missing state scope', 403);
    requireScopeState(scope.state_ids, auth.assigned_state_ids, 'subset');
    return;
  }
  // campaign_manager
  if (!scope.group_id && scope.group_ids.length === 0) throw new RbacError('Forbidden: missing group scope', 403);
  const assigned = parseGroupIds(auth.assigned_group_ids);
  if (assigned.malformed) throw new RbacError('Forbidden: malformed assigned_group_ids', 403);
  const gids = new Set(assigned.ids);
  if (gids.size === 0) throw new RbacError('Forbidden: missing assigned_group_ids', 403);
  if (scope.group_id) requireGroupAssignment(auth as any, scope.group_id);
  if (scope.group_ids.length > 0) {
    const ok = scope.group_ids.every((g) => gids.has(g));
    if (!ok) throw new RbacError('Forbidden: outside assigned_group_ids', 403);
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
    requireCampaignManagerHasAssignedGroups(auth);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);
  const adminRole = isAdmin(auth);
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

export const POST = withAudit(
  async ({ req, auth, admin }) => {
    try {
      requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
      requireModeratorHasAssignedStates(auth);
      requireCampaignManagerHasAssignedGroups(auth);
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

    const scheduled_at_raw = body?.scheduled_at != null ? String(body.scheduled_at).trim() : '';
    const scheduled_at = scheduled_at_raw ? new Date(scheduled_at_raw).toISOString() : null;
    const nowIso = new Date().toISOString();
    if (scheduled_at && scheduled_at <= nowIso) return json({ error: 'scheduled_at must be in the future' }, 400);

    // Base payload (do not break existing posts fields; keep loose)
    const payload: Record<string, unknown> = { ...(body ?? {}) };
    if (scheduled_at) {
      payload.scheduled_at = scheduled_at;
      payload.status = 'scheduled_publish';
    } else {
      payload.scheduled_at = null;
      payload.status = 'published';
    }

    // Ownership fields if present in DB (retry if missing)
    if (auth.role !== 'admin') payload.created_by = auth.user.id;

    const scope = parseScopeFromInput(payload);
    try {
      validateScopePayloadShape(auth as any, payload as any);
      requireNonEmptyScopeForPosts(auth as any, scope);
    } catch (e) {
      if (e instanceof RbacError) {
        // Ensure denied attempts are audited via scoped write engine.
        canPerformMutation(
          { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
          'posts.create',
          null,
          payload as any,
          { resourceType: 'posts', resourceName: String((payload as any)?.title ?? '') }
        );
        return json({ error: e.message }, e.status);
      }
      return json({ error: 'Forbidden' }, 403);
    }

    {
      const decision = canPerformMutation(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
        'posts.create',
        null,
        payload as any,
        { resourceType: 'posts', resourceName: String((payload as any)?.title ?? '') }
      );
      if (!decision.ok) return json({ error: decision.reason }, 403);
    }

    let insertRes = await admin.from('posts').insert(payload as any).select('*').single();
    if (insertRes.error && isMissingColumnErr(insertRes.error, 'created_by')) {
      const { created_by, ...rest } = payload;
      insertRes = await admin.from('posts').insert(rest as any).select('*').single();
    }
    if (insertRes.error && isMissingColumnErr(insertRes.error, 'status')) {
      const { status, ...rest } = payload;
      insertRes = await admin.from('posts').insert(rest as any).select('*').single();
    }
    if (insertRes.error && isMissingColumnErr(insertRes.error, 'scheduled_at')) {
      const { scheduled_at: _sa, ...rest } = payload;
      insertRes = await admin.from('posts').insert(rest as any).select('*').single();
    }

    if (insertRes.error) return json({ error: insertRes.error.message }, 500);

    const inserted = insertRes.data as Record<string, unknown>;
    const resolvedEventId = await resolvePostEventId(admin, payload);
    if (resolvedEventId && String(inserted?.event_id ?? '').trim() !== resolvedEventId) {
      const { data: linked } = await admin
        .from('posts')
        .update({ event_id: resolvedEventId })
        .eq('id', inserted.id)
        .select('*')
        .single();
      if (linked) return json({ post: linked });
    }

    return json({ post: insertRes.data });
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
      requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
      requireModeratorHasAssignedStates(auth);
      requireCampaignManagerHasAssignedGroups(auth);
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

    const beforeScope = parseScopeFromInput(before as any);

    const patchInput = {
      ...before,
      ...patch,
      // Keep scheduling fields from patch, everything else merged for scope validation.
      scheduled_at: (patch as any).scheduled_at,
    } as Record<string, unknown>;
    const nextScope = parseScopeFromInput(patchInput);

    // Enforce BOTH previous row scope and incoming payload scope (deny if scope missing/malformed).
    try {
      validateScopePayloadShape(auth as any, patch as any);
      requireNonEmptyScopeForPosts(auth as any, beforeScope);
      requireNonEmptyScopeForPosts(auth as any, nextScope);
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
        { created_by: (before as any)?.created_by, state_ids: beforeScope.state_ids, group_id: beforeScope.group_id, group_ids: beforeScope.group_ids } as any,
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
    if (auth.role !== 'admin') delete nextPatch.created_by;
    // Prevent non-admin from writing malformed scope payload.
    if (auth.role !== 'admin') {
      if (nextScope.state_ids.length > 0) nextPatch.state_id = nextScope.state_ids;
      if (nextScope.group_id) nextPatch.group_id = nextScope.group_id;
      if (nextScope.group_ids.length > 0) nextPatch.target_groups = nextScope.group_ids;
    }

    const resolvedEventId = await resolvePostEventId(admin, { ...before, ...nextPatch });
    if (resolvedEventId) nextPatch.event_id = resolvedEventId;

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

