import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { BroadcastPayload } from '@/lib/broadcast-send';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { canPerformMutation } from '@/lib/rbac/scoped-write-engine';
import { RbacError, requireModeratorHasAssignedStates, requireRole, toNumArray } from '@/lib/rbac/require';
import { withAudit } from '@/lib/audit/withAudit';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

type Body = {
  scheduled_at?: string;
  payload?: BroadcastPayload;
  idempotency_key?: string;
};

export const POST = withAudit(
  async ({ req, auth, admin }) => {
    let body: Body = {};
    try {
      body = (await req.json()) as Body;
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const scheduled_at = String(body.scheduled_at ?? '').trim();
    const idempotency_key = String(body.idempotency_key ?? '').trim();
    let payload = (body.payload ?? null) as BroadcastPayload | null;
    if (!scheduled_at) return json({ error: 'scheduled_at is required' }, 400);
    if (!idempotency_key) return json({ error: 'idempotency_key is required' }, 400);
    if (!payload) return json({ error: 'payload is required' }, 400);

    try {
      requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
      requireModeratorHasAssignedStates(auth);
    } catch (e) {
      if (e instanceof RbacError) return json({ error: e.message }, e.status);
      return json({ error: 'Forbidden' }, 403);
    }

    // Enforce same RBAC shaping as "send now"
    if (auth.role === 'moderator') {
      payload = {
        ...payload,
        all_workers: false,
        filters: {
          ...(payload.filters ?? {}),
          assigned_state_ids: auth.assigned_state_ids,
        } as any,
      };
    }

    if (auth.role === 'campaign_manager') {
      payload = {
        ...payload,
        all_workers: false,
        filters: { group_ids: [] } as any,
      };
      const groupIds = toNumArray(auth.assigned_group_ids);
      if (groupIds.length === 0) return json({ error: 'Forbidden: no assigned groups to target' }, 403);
      const ok = canAccessResource(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids },
        { group_ids: groupIds.map(String) }
      );
      if (!ok) return json({ error: 'Forbidden' }, 403);
      (payload.filters as any).group_ids = groupIds;
    }

    {
      const decision = canPerformMutation(
        { id: auth.user.id, role: auth.role, assigned_state_ids: auth.assigned_state_ids, assigned_group_ids: auth.assigned_group_ids } as any,
        'notifications.schedule',
        null,
        { filters: (payload as any).filters } as any,
        { resourceType: 'scheduled_notifications', resourceName: String((payload as any)?.title ?? '') }
      );
      if (!decision.ok) return json({ error: decision.reason }, 403);
    }

    const row = {
      created_by: auth.user.id,
      created_role: auth.role,
      status: 'pending',
      scheduled_at,
      payload,
      idempotency_key,
    };

    const { data, error } = await admin.from('scheduled_notifications').insert(row as any).select('*').single();
    if (error) {
      const isDup = (error as any)?.code === '23505' || /duplicate key/i.test(error.message);
      return json({ error: error.message, duplicate: isDup }, isDup ? 409 : 500);
    }

    return json({ ok: true, scheduled: data });
  },
  {
    action_type: 'scheduled_notifications.create',
    resource_type: 'scheduled_notifications',
    severity: 'info',
    undoable: true,
    build: ({ auth, response_json }) => {
      const scheduled = response_json?.scheduled ?? null;
      const payload = scheduled?.payload ?? null;
      const scope_group_ids =
        auth.role === 'campaign_manager' ? (((payload?.filters as any)?.group_ids ?? []) as any[]).map((x) => String(x)) : [];
      const scope_state_ids = auth.role === 'moderator' ? auth.assigned_state_ids : [];
      return {
        resource_id: String(scheduled?.id ?? ''),
        resource_name: String(payload?.title ?? ''),
        new_data: scheduled,
        scope_state_ids,
        scope_group_ids,
      };
    },
  }
);

