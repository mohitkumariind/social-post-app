import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import {
  RbacError,
  requireModeratorHasAssignedStates,
  requireOwnership,
  requireRole,
  requireScopeState,
  toNumArray,
} from '@/lib/rbac/require';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
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
  const db = admin ?? supabase;

  const id = (request.nextUrl.searchParams.get('id') ?? '').trim();
  const name = (request.nextUrl.searchParams.get('name') ?? '').trim();

  const includeDeleted = (request.nextUrl.searchParams.get('include_deleted') ?? '').trim() === '1';

  // Detail fetch (used by admin UI for secure reads).
  if (id || name) {
    let q = db.from('events').select('*').limit(1) as any;
    q = id ? q.eq('id', id) : q.eq('name', name);
    if (!includeDeleted) q = q.is('deleted_at', null);
    const { data, error } = await q.maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: 'Not found' }, 404);

    try {
      if (auth.role === 'moderator') {
        requireOwnership((data as any).created_by, auth.user.id);
        requireScopeState((data as any).state_id, auth.assigned_state_ids, 'subset');
      }
      if (auth.role === 'campaign_manager') {
        requireOwnership((data as any).created_by, auth.user.id);
      }
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    return json({ event: data, usedServiceRole: !!admin });
  }

  // Listing
  let q = db.from('events').select('*').order('created_at', { ascending: false }) as any;
  if (!includeDeleted) q = q.is('deleted_at', null);
  if (auth.role === 'moderator') {
    // Must satisfy BOTH: ownership and assigned states.
    q = q.eq('created_by', auth.user.id).overlaps('state_id', auth.assigned_state_ids);
  }
  if (auth.role === 'campaign_manager') {
    // Campaign managers only see their own events.
    q = q.eq('created_by', auth.user.id);
  }
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ events: data ?? [], usedServiceRole: !!admin });
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

  if (auth.role === 'moderator') {
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

  if (auth.role === 'campaign_manager') {
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

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const { data, error } = await admin.from('events').insert(payload).select().single();
  if (error) return json({ error: error.message }, 500);

  void logAdminAction({
    actor_user_id: auth.user.id,
    actor_role: auth.role,
    action_type: 'events.create',
    resource_type: 'events',
    resource_id: String((data as any)?.id ?? ''),
    resource_name: String((data as any)?.name ?? ''),
    previous_data: null,
    new_data: data,
    severity: 'info',
    undoable: true,
    scope_state_ids: toNumArray((data as any)?.state_id),
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

  if (auth.role === 'moderator') {
    const { data: ev, error: evErr } = await admin
      .from('events')
      .select('id,state_id,target_groups,created_by')
      .eq('id', id)
      .maybeSingle();
    if (evErr) return json({ error: evErr.message }, 500);
    try {
      requireOwnership((ev as any)?.created_by, auth.user.id);
      requireScopeState((ev as any)?.state_id, auth.assigned_state_ids, 'subset');
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }
    const existingStateIds = toNumArray((ev as any)?.state_id);
    const nextStateIds = patch.state_id != null ? toNumArray(patch.state_id) : existingStateIds;
    try {
      requireScopeState(nextStateIds, auth.assigned_state_ids, 'subset');
    } catch {
      return json({ error: 'Forbidden: cannot set states outside assignment' }, 403);
    }
    const nextTargetGroups = patch.target_groups != null ? (Array.isArray(patch.target_groups) ? patch.target_groups : []) : ((ev as any)?.target_groups ?? []);
    if (Array.isArray(nextTargetGroups) && nextTargetGroups.length > 0) return json({ error: 'Forbidden: moderators cannot use target_groups events' }, 403);

    // Never allow moderators to change ownership.
    if (patch.created_by != null) return json({ error: 'Forbidden' }, 403);
  }

  if (auth.role === 'campaign_manager') {
    const { data: ev, error: evErr } = await admin.from('events').select('id,created_by').eq('id', id).maybeSingle();
    if (evErr) return json({ error: evErr.message }, 500);
    try {
      requireOwnership((ev as any)?.created_by, auth.user.id);
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
      ? 'events.publish'
      : beforeStatus !== afterStatus && afterStatus === 'archived'
        ? 'events.archive'
        : beforeStatus !== afterStatus && afterStatus === 'draft'
          ? 'events.unpublish'
          : 'events.update';

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

  if (auth.role === 'moderator') {
    const { data: ev, error: evErr } = await admin.from('events').select('id,state_id,created_by').eq('id', id).maybeSingle();
    if (evErr) return json({ error: evErr.message }, 500);
    try {
      requireOwnership((ev as any)?.created_by, auth.user.id);
      requireScopeState((ev as any)?.state_id, auth.assigned_state_ids, 'subset');
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }
  }

  if (auth.role === 'campaign_manager') {
    const { data: ev, error: evErr } = await admin.from('events').select('id,created_by').eq('id', id).maybeSingle();
    if (evErr) return json({ error: evErr.message }, 500);
    try {
      requireOwnership((ev as any)?.created_by, auth.user.id);
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

