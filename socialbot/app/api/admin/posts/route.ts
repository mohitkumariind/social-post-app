import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RbacError, requireModeratorHasAssignedStates, requireOwnership, requireRole, requireScopeState, toNumArray } from '@/lib/rbac/require';
import { withAudit } from '@/lib/audit/withAudit';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isMissingColumnErr(err: { message?: string } | null | undefined, columnName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column'));
}

async function selectPostsList(admin: any) {
  // Try “new schema” first (status/deleted_at/scheduled_at/created_by)
  const res = await admin
    .from('posts')
    .select('id,title,image_url,category,created_at,scheduled_at,status,deleted_at,created_by,state_id,group_id')
    .order('created_at', { ascending: false })
    .limit(200);
  if (!res.error) return { data: res.data ?? [], error: null, hasStatus: true, hasDeletedAt: true, hasScheduledAt: true, hasCreatedBy: true };

  // Fall back if some columns don’t exist (older DB)
  const cols = 'id,title,image_url,category,created_at,state_id,group_id';
  const res2 = await admin.from('posts').select(cols).order('created_at', { ascending: false }).limit(200);
  return { data: res2.data ?? [], error: res2.error ?? res.error, hasStatus: false, hasDeletedAt: false, hasScheduledAt: false, hasCreatedBy: false };
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
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const res = await selectPostsList(admin);
  if (res.error) return json({ error: res.error.message }, 500);

  let rows: any[] = res.data ?? [];

  // RBAC filtering (best-effort without breaking older schemas)
  if (auth.role === 'campaign_manager' && res.hasCreatedBy) {
    rows = rows.filter((r) => String(r.created_by ?? '').trim() === auth.user.id);
  }
  if (auth.role === 'moderator') {
    // State-scope: only posts within assigned_state_ids.
    // If state_id missing, preserve prior behavior (don’t break).
    rows = rows.filter((r) => {
      const stateIds = toNumArray((r as any).state_id);
      if (stateIds.length === 0) return true;
      try {
        requireScopeState(stateIds, auth.assigned_state_ids, 'overlap');
        return true;
      } catch {
        return false;
      }
    });
  }

  return json({ posts: rows, schema: res });
}

export const POST = withAudit(
  async ({ req, auth, admin }) => {
    try {
      requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
      requireModeratorHasAssignedStates(auth);
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
    payload.created_by = auth.user.id;

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

    // RBAC: ownership checks (best-effort)
    if (auth.role === 'campaign_manager') {
      try {
        requireOwnership(before.created_by, auth.user.id);
      } catch {
        return json({ error: 'Forbidden' }, 403);
      }
    }
    if (auth.role === 'moderator') {
      const stateIds = toNumArray(before.state_id);
      if (stateIds.length > 0) {
        try {
          requireScopeState(stateIds, auth.assigned_state_ids, 'overlap');
        } catch {
          return json({ error: 'Forbidden' }, 403);
        }
      }
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

