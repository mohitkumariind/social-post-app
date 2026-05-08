import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logAdminAction } from '@/lib/audit/logAdminAction';

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

export async function POST(_req: NextRequest, ctx: { params: Promise<{ logId: string }> }) {
  const { logId } = await ctx.params;

  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);

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

  // RBAC: reuse Activity Center visibility rules to decide if the actor can undo this log.
  if (auth.role === 'campaign_manager') {
    if (String((logRow as any).actor_user_id ?? '') !== auth.user.id) return json({ error: 'Forbidden' }, 403);
  }
  if (auth.role === 'moderator') {
    if (auth.assigned_state_ids.length === 0) return json({ error: 'Moderator is missing assigned_state_ids' }, 403);
    const isOwn = String((logRow as any).actor_user_id ?? '') === auth.user.id;
    const scopeStateIds = Array.isArray((logRow as any).scope_state_ids) ? (logRow as any).scope_state_ids : [];
    const overlaps = scopeStateIds.some((x: any) => auth.assigned_state_ids.includes(Number(x)));
    if (!isOwn && !overlaps) return json({ error: 'Forbidden' }, 403);
  }

  const resourceType = String((logRow as any).resource_type ?? '').trim();
  const actionType = String((logRow as any).action_type ?? '').trim();
  const resourceId = String((logRow as any).resource_id ?? '').trim();
  const previousData = ((logRow as any).previous_data ?? null) as Record<string, unknown> | null;
  const metadata = ((logRow as any).metadata ?? {}) as Record<string, unknown>;

  if (!resourceType || !resourceId) return json({ error: 'Undo is unavailable for this log' }, 400);

  // Execute undo
  let undoResult: any = null;

  if (resourceType === 'events') {
    if (actionType === 'events.delete') {
      const { data, error } = await admin
        .from('events')
        .update({ deleted_at: null, deleted_by: null, status: (previousData as any)?.status ?? 'published' })
        .eq('id', resourceId)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      undoResult = data;
    } else if (actionType === 'events.update') {
      if (!previousData) return json({ error: 'Missing previous_data snapshot' }, 400);
      const patch = pickPatchFromRow(previousData);
      const { data, error } = await admin.from('events').update(patch as any).eq('id', resourceId).select().single();
      if (error) return json({ error: error.message }, 500);
      undoResult = data;
    } else if (actionType === 'events.publish') {
      const { data, error } = await admin
        .from('events')
        .update({ status: 'draft', published_at: null, published_by: null })
        .eq('id', resourceId)
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      undoResult = data;
    } else {
      return json({ error: 'Unsupported undo action for events' }, 400);
    }
  } else if (resourceType === 'groups') {
    if (actionType !== 'groups.delete') return json({ error: 'Unsupported undo action for groups' }, 400);
    const { data: grp, error: gErr } = await admin
      .from('groups')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', Number(resourceId))
      .select()
      .single();
    if (gErr) return json({ error: gErr.message }, 500);
    const memberIds = Array.isArray((metadata as any).member_ids) ? (metadata as any).member_ids.map((x: any) => String(x)).filter(Boolean) : [];
    if (memberIds.length > 0) {
      const { error: upErr } = await admin.from('profiles').update({ group_id: Number(resourceId) }).in('id', memberIds);
      if (upErr) return json({ error: upErr.message }, 500);
    }
    undoResult = grp;
  } else if (resourceType === 'notification_templates') {
    // Template delete uses deleted_at.
    if (actionType !== 'templates.delete') return json({ error: 'Unsupported undo action for templates' }, 400);
    const { data, error } = await admin.from('notification_templates').update({ deleted_at: null }).eq('id', resourceId).select().single();
    if (error) return json({ error: error.message }, 500);
    undoResult = data;
  } else {
    return json({ error: 'Unsupported resource_type for undo' }, 400);
  }

  // Mark original log as undone
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

