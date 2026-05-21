import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleClient, isElevatedDashboardRole, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { resolveScope } from '@/lib/rbac/unified-scope-engine';
import { RbacError, requireStandardRbacContext, toNumArray, toStrArray } from '@/lib/rbac/require';
import { trackRbacEvent } from '@/lib/rbac/rbac-observability-engine';
import { canPerformMutation, type MutationAction } from '@/lib/rbac/mutation-gateway';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isMissingTableErr(err: { message?: string } | null | undefined, tableName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return (
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes(tableName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('relation')))
  );
}

function pickPatchFromRow(row: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = { ...row };
  delete patch.id;
  delete patch.created_at;
  delete patch.updated_at;
  return patch;
}

function subsetNums(a: unknown, b: number[]): boolean {
  const aa = toNumArray(a);
  if (aa.length === 0 || b.length === 0) return false;
  const set = new Set(b.map(Number));
  return aa.every((n) => set.has(Number(n)));
}

function subsetStr(a: unknown, b: string[]): boolean {
  const aa = toStrArray(a);
  if (aa.length === 0 || b.length === 0) return false;
  const set = new Set(b.map((x) => String(x).trim()).filter(Boolean));
  return aa.every((s) => set.has(String(s).trim()));
}

type UndoAuth = Extract<Awaited<ReturnType<typeof validateAdminSession>>, { ok: true }>;

function mutationUserFromAuth(auth: UndoAuth) {
  return {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
}

function requireUndoMutation(
  auth: UndoAuth,
  action: MutationAction,
  resourceType: string,
  resource: Record<string, unknown> | null,
  payload: Record<string, unknown> | null,
  audit: { resourceId?: string; resourceName?: string }
): NextResponse | null {
  const decision = canPerformMutation(mutationUserFromAuth(auth), action, resource, payload, {
    resourceType,
    resourceId: audit.resourceId,
    resourceName: audit.resourceName,
  });
  if (!decision.ok) return json({ error: decision.reason }, 403);
  return null;
}

async function fetchResourceForUndoExecution(
  admin: SupabaseClient,
  resourceType: string,
  resourceId: string
): Promise<{ row: Record<string, unknown> | null; error: NextResponse | null }> {
  if (resourceType === 'events') {
    const { data, error } = await admin.from('events').select('*').eq('id', resourceId).maybeSingle();
    if (error) return { row: null, error: json({ error: error.message }, 500) };
    if (!data) return { row: null, error: json({ error: 'Event not found for undo' }, 404) };
    return { row: data as Record<string, unknown>, error: null };
  }
  if (resourceType === 'groups') {
    const { data, error } = await admin.from('groups').select('*').eq('id', Number(resourceId)).maybeSingle();
    if (error) return { row: null, error: json({ error: error.message }, 500) };
    if (!data) return { row: null, error: json({ error: 'Group not found for undo' }, 404) };
    return { row: data as Record<string, unknown>, error: null };
  }
  if (resourceType === 'notification_templates') {
    const { data, error } = await admin.from('notification_templates').select('*').eq('id', resourceId).maybeSingle();
    if (error) return { row: null, error: json({ error: error.message }, 500) };
    if (!data) return { row: null, error: json({ error: 'Template not found for undo' }, 404) };
    return { row: data as Record<string, unknown>, error: null };
  }
  return { row: null, error: json({ error: 'Unsupported resource_type for undo' }, 400) };
}

/** Re-fetch target row and re-run mutation gate immediately before applying restore (TOCTOU-safe). */
async function requireUndoMutationAtExecution(
  admin: SupabaseClient,
  auth: UndoAuth,
  action: MutationAction,
  resourceType: string,
  resourceId: string,
  payload: Record<string, unknown> | null,
  audit: { resourceId?: string; resourceName?: string }
): Promise<{ denied: NextResponse | null; freshRow: Record<string, unknown> | null }> {
  const { row, error } = await fetchResourceForUndoExecution(admin, resourceType, resourceId);
  if (error) return { denied: error, freshRow: null };
  const resourceName =
    audit.resourceName ??
    String((row as { title?: unknown; name?: unknown })?.title ?? (row as { name?: unknown })?.name ?? resourceId);
  const denied = requireUndoMutation(auth, action, resourceType, row, payload, {
    resourceId: audit.resourceId ?? resourceId,
    resourceName,
  });
  return { denied, freshRow: row };
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ logId: string }> }) {
  const { logId } = await ctx.params;

  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireStandardRbacContext(auth, ['admin', 'moderator', 'campaign_manager']);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const { data: logRow, error: logErr } = await admin.from('admin_logs').select('*').eq('id', logId).maybeSingle();
  if (logErr) {
    if (isMissingTableErr(logErr, 'admin_logs')) {
      return json({ error: 'Activity Center schema is not deployed yet (admin_logs missing)' }, 503);
    }
    return json({ error: logErr.message }, 500);
  }
  if (!logRow) return json({ error: 'Not found' }, 404);
  if (!(logRow as any).undoable) return json({ error: 'This action is not undoable' }, 400);
  if ((logRow as any).undone_at) return json({ error: 'Already undone' }, 409);

  // RBAC: must be able to *view* the log in Activity Center to undo it.
  if (!isElevatedDashboardRole(auth.role)) {
    const scope = resolveScope({
      role: auth.role,
      assigned_state_ids: auth.assigned_state_ids,
      assigned_group_ids: auth.assigned_group_ids,
    });
    if (scope.type === 'STATE') {
      if (!subsetNums((logRow as any).scope_state_ids, scope.states)) return json({ error: 'Forbidden' }, 403);
    } else if (scope.type === 'GROUP') {
      if (!subsetStr((logRow as any).scope_group_ids, scope.groups)) return json({ error: 'Forbidden' }, 403);
    } else {
      return json({ error: 'Forbidden' }, 403);
    }
  }

  void trackRbacEvent({
    user_id: auth.user.id,
    role: auth.role,
    event_type: 'undo',
    action: 'activity.undo',
    resource_type: 'admin_logs',
    resource_id: logId,
    result: 'allowed',
    scope_state_ids: Array.isArray((logRow as any).scope_state_ids) ? (logRow as any).scope_state_ids : [],
    scope_group_ids: Array.isArray((logRow as any).scope_group_ids) ? (logRow as any).scope_group_ids : [],
    severity: 'info',
    metadata: { resource_type: String((logRow as any).resource_type ?? ''), action_type: String((logRow as any).action_type ?? '') },
  });

  const resourceType = String((logRow as any).resource_type ?? '').trim();
  const actionType = String((logRow as any).action_type ?? '').trim();
  const resourceId = String((logRow as any).resource_id ?? '').trim();
  const previousData = ((logRow as any).previous_data ?? null) as Record<string, unknown> | null;
  const metadata = ((logRow as any).metadata ?? {}) as Record<string, unknown>;

  if (!resourceType || !resourceId) return json({ error: 'Undo is unavailable for this log' }, 400);

  let undoResult: any = null;

  if (resourceType === 'events') {
    if (actionType === 'events.delete') {
      const patch = {
        deleted_at: null,
        deleted_by: null,
        status: (previousData as any)?.status ?? 'published',
      };
      const exec = await requireUndoMutationAtExecution(
        admin,
        auth,
        'events.update',
        'events',
        resourceId,
        patch,
        { resourceId, resourceName: String((previousData as any)?.title ?? resourceId) }
      );
      if (exec.denied) return exec.denied;
      const { data, error } = await admin.from('events').update(patch).eq('id', resourceId).select().single();
      if (error) return json({ error: error.message }, 500);
      undoResult = data;
    } else if (actionType === 'events.update') {
      if (!previousData) return json({ error: 'Missing previous_data snapshot' }, 400);
      const patch = pickPatchFromRow(previousData);
      const exec = await requireUndoMutationAtExecution(admin, auth, 'events.update', 'events', resourceId, patch, {
        resourceId,
        resourceName: String((previousData as any).title ?? resourceId),
      });
      if (exec.denied) return exec.denied;
      const { data, error } = await admin.from('events').update(patch as any).eq('id', resourceId).select().single();
      if (error) return json({ error: error.message }, 500);
      undoResult = data;
    } else if (actionType === 'events.publish') {
      const patch = { status: 'draft', published_at: null, published_by: null };
      const exec = await requireUndoMutationAtExecution(admin, auth, 'events.update', 'events', resourceId, patch, {
        resourceId,
        resourceName: String((previousData as any)?.title ?? resourceId),
      });
      if (exec.denied) return exec.denied;
      const { data, error } = await admin.from('events').update(patch).eq('id', resourceId).select().single();
      if (error) return json({ error: error.message }, 500);
      undoResult = data;
    } else {
      return json({ error: 'Unsupported undo action for events' }, 400);
    }
  } else if (resourceType === 'groups') {
    if (actionType !== 'groups.delete') return json({ error: 'Unsupported undo action for groups' }, 400);
    const groupPatch = { deleted_at: null, deleted_by: null };
    const execGroup = await requireUndoMutationAtExecution(
      admin,
      auth,
      'groups.update',
      'groups',
      resourceId,
      groupPatch,
      { resourceId, resourceName: String((metadata as any).group_name ?? resourceId) }
    );
    if (execGroup.denied) return execGroup.denied;
    const { data: grp, error: gErr } = await admin
      .from('groups')
      .update(groupPatch)
      .eq('id', Number(resourceId))
      .select()
      .single();
    if (gErr) return json({ error: gErr.message }, 500);
    const memberIds = Array.isArray((metadata as any).member_ids)
      ? (metadata as any).member_ids.map((x: any) => String(x)).filter(Boolean)
      : [];
    if (memberIds.length > 0) {
      const freshGroup = execGroup.freshRow ?? grp;
      const execMembers = await requireUndoMutationAtExecution(
        admin,
        auth,
        'groups.members.add',
        'groups',
        resourceId,
        { userIds: memberIds, tag: String(resourceId) },
        { resourceId, resourceName: String((freshGroup as any)?.name ?? resourceId) }
      );
      if (execMembers.denied) return execMembers.denied;
      const { error: upErr } = await admin.from('profiles').update({ group_id: Number(resourceId) }).in('id', memberIds);
      if (upErr) return json({ error: upErr.message }, 500);
    }
    undoResult = grp;
  } else if (resourceType === 'notification_templates') {
    if (actionType !== 'templates.delete') return json({ error: 'Unsupported undo action for templates' }, 400);
    const tplPatch = { deleted_at: null };
    const execTpl = await requireUndoMutationAtExecution(
      admin,
      auth,
      'templates.update',
      'notification_templates',
      resourceId,
      tplPatch,
      { resourceId, resourceName: String((previousData as any)?.title ?? (previousData as any)?.name ?? resourceId) }
    );
    if (execTpl.denied) return execTpl.denied;
    const { data, error } = await admin
      .from('notification_templates')
      .update(tplPatch)
      .eq('id', resourceId)
      .select()
      .single();
    if (error) return json({ error: error.message }, 500);
    undoResult = data;
  } else {
    return json({ error: 'Unsupported resource_type for undo' }, 400);
  }

  const { error: markErr } = await admin
    .from('admin_logs')
    .update({ undone_at: new Date().toISOString(), undone_by: auth.user.id })
    .eq('id', logId);
  if (markErr) return json({ error: markErr.message }, 500);

  void logAdminAction({
    actor_user_id: auth.user.id,
    actor_role: auth.role,
    action_type: 'activity.undo',
    resource_type: 'admin_logs',
    resource_id: logId,
    resource_name: `${resourceType}:${resourceId}`,
    previous_data: logRow,
    new_data: { undone: true, undo_result: undoResult },
    severity: 'warning',
    undoable: false,
    scope_state_ids: Array.isArray((logRow as any).scope_state_ids) ? (logRow as any).scope_state_ids : [],
    scope_group_ids: Array.isArray((logRow as any).scope_group_ids) ? (logRow as any).scope_group_ids : [],
    scope_user_ids: Array.isArray((logRow as any).scope_user_ids) ? (logRow as any).scope_user_ids : [],
  });

  return json({ ok: true, undone: true, result: undoResult });
}
