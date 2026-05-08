import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { RbacError, requireRole } from '@/lib/rbac/require';
import { canPerformMutation } from '@/lib/rbac/scoped-write-engine';
import { withAudit } from '@/lib/audit/withAudit';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, auth.status);
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  let q = admin.from('notification_templates').select('*').is('deleted_at', null).order('created_at', { ascending: false }) as any;
  if (auth.role !== 'admin') q = q.eq('created_by', auth.user.id);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ templates: data ?? [] });
}

export const POST = withAudit(
  async ({ req, auth, admin }) => {
    try {
      requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    let body: any = {};
    try {
      body = (await req.json()) as any;
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const row = {
      title: String(body.title ?? '').trim(),
      body: String(body.body ?? '').trim(),
      image_url: body.image_url != null ? String(body.image_url).trim() : null,
      category: body.category != null ? String(body.category).trim() : null,
      created_by: auth.user.id,
      updated_at: new Date().toISOString(),
    };
    if (!row.title || !row.body) return json({ error: 'title and body are required' }, 400);

    const decision = canPerformMutation(
      { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
      'templates.create',
      null,
      row as any,
      { resourceType: 'notification_templates', resourceName: row.title }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);

    const { data, error } = await admin.from('notification_templates').insert(row as any).select('*').single();
    if (error) return json({ error: error.message }, 500);
    return json({ template: data });
  },
  {
    action_type: 'templates.create',
    resource_type: 'notification_templates',
    severity: 'info',
    undoable: true,
    build: ({ response_json }) => ({
      resource_id: String(response_json?.template?.id ?? ''),
      resource_name: String(response_json?.template?.title ?? ''),
      new_data: response_json?.template ?? response_json,
    }),
  }
);

export const PATCH = withAudit(
  async ({ req, auth, admin, previous_data }) => {
    try {
      requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    let body: any = {};
    try {
      body = (await req.json()) as any;
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const id = String(body.id ?? '').trim();
    const patch = body.patch && typeof body.patch === 'object' ? (body.patch as any) : null;
    if (!id || !patch) return json({ error: 'Missing id or patch' }, 400);

    const before = previous_data as any;
    if (!before || before.deleted_at != null) return json({ error: 'Not found' }, 404);
    if (
      auth.role !== 'admin' &&
      !canAccessResource(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids },
        { created_by: before.created_by }
      )
    ) {
      return json({ error: 'Forbidden' }, 403);
    }

    const decision = canPerformMutation(
      { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
      'templates.update',
      { created_by: before.created_by },
      patch as any,
      { resourceType: 'notification_templates', resourceId: id, resourceName: String(before?.title ?? '') }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);

    const safePatch: any = { updated_at: new Date().toISOString() };
    if (patch.title != null) safePatch.title = String(patch.title).trim();
    if (patch.body != null) safePatch.body = String(patch.body).trim();
    if (patch.image_url !== undefined) safePatch.image_url = patch.image_url ? String(patch.image_url).trim() : null;
    if (patch.category !== undefined) safePatch.category = patch.category ? String(patch.category).trim() : null;

    const { data, error } = await admin.from('notification_templates').update(safePatch).eq('id', id).select('*').single();
    if (error) return json({ error: error.message }, 500);
    return json({ template: data });
  },
  {
    action_type: 'templates.update',
    resource_type: 'notification_templates',
    severity: 'info',
    undoable: true,
    getPreviousData: async ({ req, admin }) => {
      const body = (await req.clone().json().catch(() => ({}))) as any;
      const id = String(body?.id ?? '').trim();
      if (!id) return null as any;
      const { data } = await admin.from('notification_templates').select('*').eq('id', id).maybeSingle();
      return data as any;
    },
    build: ({ response_json }) => ({
      resource_id: String(response_json?.template?.id ?? ''),
      resource_name: String(response_json?.template?.title ?? ''),
      new_data: response_json?.template ?? response_json,
    }),
  }
);

export const DELETE = withAudit(
  async ({ req, auth, admin, previous_data }) => {
    try {
      requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    const id = (req.nextUrl.searchParams.get('id') ?? '').trim();
    if (!id) return json({ error: 'Missing id' }, 400);

    const before = previous_data as any;
    if (!before || before.deleted_at != null) return json({ ok: true, alreadyDeleted: true });
    if (
      auth.role !== 'admin' &&
      !canAccessResource(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids },
        { created_by: before.created_by }
      )
    ) {
      return json({ error: 'Forbidden' }, 403);
    }

    const decision = canPerformMutation(
      { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
      'templates.delete',
      { created_by: before.created_by },
      null,
      { resourceType: 'notification_templates', resourceId: id, resourceName: String(before?.title ?? '') }
    );
    if (!decision.ok) return json({ error: decision.reason }, 403);

    const patch = { deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data, error } = await admin.from('notification_templates').update(patch).eq('id', id).select('*').single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  },
  {
    action_type: 'templates.delete',
    resource_type: 'notification_templates',
    severity: 'warning',
    undoable: true,
    getPreviousData: async ({ req, admin }) => {
      const id = (req.nextUrl.searchParams.get('id') ?? '').trim();
      if (!id) return null as any;
      const { data } = await admin.from('notification_templates').select('*').eq('id', id).maybeSingle();
      return data as any;
    },
    build: ({ req, previous_data }) => ({
      resource_id: (req.nextUrl.searchParams.get('id') ?? '').trim(),
      resource_name: String((previous_data as any)?.title ?? ''),
    }),
  }
);

