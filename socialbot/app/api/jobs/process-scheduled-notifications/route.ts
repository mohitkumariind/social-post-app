import Expo from 'expo-server-sdk';
import { createServiceRoleClient } from '@/lib/admin-gate';
import { runBroadcast, type BroadcastPayload } from '@/lib/broadcast-send';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';

export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const got = request.headers.get('x-cron-secret')?.trim();
    if (!got || got !== secret) return json({ error: 'Unauthorized' }, 401);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: due, error } = await admin
    .from('scheduled_notifications')
    .select('*')
    // include stale processing jobs so they can be reclaimed
    .or(`and(status.in.(pending,failed),scheduled_at.lte.${nowIso}),and(status.eq.processing,locked_at.lt.${staleIso})`)
    .order('scheduled_at', { ascending: true })
    .limit(10);
  if (error) return json({ error: error.message }, 500);

  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const expo = new Expo(accessToken ? { accessToken } : undefined);

  const results: any[] = [];
  for (const job of due ?? []) {
    const jobId = String((job as any).id ?? '');
    if (!jobId) continue;

    // Claim lock (best-effort)
    const claim = {
      status: 'processing',
      locked_at: new Date().toISOString(),
      locked_by: 'api/jobs/process-scheduled-notifications',
    };
    const { data: claimed, error: claimErr } = await admin
      .from('scheduled_notifications')
      .update(claim)
      .eq('id', jobId)
      .or(`status.in.(pending,failed),and(status.eq.processing,locked_at.lt.${staleIso})`)
      .select('*')
      .maybeSingle();
    if (claimErr || !claimed) continue;

    // Idempotency safety: if any job with same idempotency_key is already sent, skip sending.
    const idem = String((claimed as any).idempotency_key ?? '').trim();
    if (idem) {
      const { data: sentDup } = await admin
        .from('scheduled_notifications')
        .select('id,status,sent_at')
        .eq('idempotency_key', idem)
        .eq('status', 'sent')
        .limit(1)
        .maybeSingle();
      if (sentDup && String((sentDup as any).id ?? '') !== jobId) {
        await admin
          .from('scheduled_notifications')
          .update({ status: 'cancelled', last_error: 'Duplicate idempotency_key already sent' })
          .eq('id', jobId);
        results.push({ id: jobId, ok: true, skipped: true, reason: 'duplicate idempotency_key already sent' });
        continue;
      }
    }

    const attempt = Number((claimed as any).attempt_count ?? 0) + 1;
    const payload = ((claimed as any).payload ?? null) as BroadcastPayload | null;
    if (!payload) {
      await admin
        .from('scheduled_notifications')
        .update({ status: 'failed', attempt_count: attempt, last_error: 'Missing payload' })
        .eq('id', jobId);
      results.push({ id: jobId, ok: false, error: 'Missing payload' });
      continue;
    }

    try {
      // RBAC re-validation (never bypass): confirm creator role/scope can target this payload.
      const createdBy = String((claimed as any).created_by ?? '').trim();
      const createdRole = String((claimed as any).created_role ?? '').trim().toLowerCase();
      if (createdRole === 'moderator' || createdRole === 'campaign_manager') {
        // Fetch creator profile scope (service-role) so tampered payloads cannot bypass.
        const { data: prof, error: pErr } = await admin
          .from('profiles')
          .select('id, role, assigned_state_ids, assigned_group_ids')
          .eq('id', createdBy)
          .maybeSingle();
        if (pErr) throw new Error(pErr.message);
        const role = String((prof as any)?.role ?? createdRole).trim().toLowerCase();
        const user = {
          id: createdBy,
          role: role === 'moderator' ? ('moderator' as const) : ('campaign_manager' as const),
          assigned_state_ids: Array.isArray((prof as any)?.assigned_state_ids) ? (prof as any).assigned_state_ids : [],
          assigned_group_ids: Array.isArray((prof as any)?.assigned_group_ids) ? (prof as any).assigned_group_ids : [],
        };

        const filters = (payload as any)?.filters ?? {};
        const resource =
          user.role === 'moderator'
            ? { state_ids: (filters as any).assigned_state_ids }
            : { group_ids: (filters as any).group_ids };

        if (!canAccessResource(user as any, resource as any)) {
          await admin
            .from('scheduled_notifications')
            .update({ status: 'failed', attempt_count: attempt, last_error: 'Forbidden: payload target outside creator scope' })
            .eq('id', jobId);
          results.push({ id: jobId, ok: false, error: 'Forbidden: payload target outside creator scope' });
          void logAdminAction({
            actor_user_id: createdBy || null,
            actor_role: createdRole || 'unknown',
            action_type: 'scheduled_notifications.failed',
            resource_type: 'scheduled_notifications',
            resource_id: jobId,
            resource_name: (payload as any).title ?? null,
            previous_data: claimed,
            new_data: { status: 'failed', error: 'Forbidden: payload target outside creator scope' },
            severity: 'critical',
            undoable: false,
            scope_state_ids: user.role === 'moderator' ? user.assigned_state_ids : [],
            scope_group_ids: user.role === 'campaign_manager' ? user.assigned_group_ids : [],
          });
          continue;
        }
      }

      const payloadToSend = { ...(payload as any), preview: false } as BroadcastPayload;
      const r = await runBroadcast(admin, expo, payloadToSend);
      if (!r.ok) {
        await admin
          .from('scheduled_notifications')
          .update({ status: 'failed', attempt_count: attempt, last_error: r.error })
          .eq('id', jobId);
        results.push({ id: jobId, ok: false, error: r.error });

        void logAdminAction({
          actor_user_id: (claimed as any).created_by ?? null,
          actor_role: String((claimed as any).created_role ?? 'unknown'),
          action_type: 'scheduled_notifications.failed',
          resource_type: 'scheduled_notifications',
          resource_id: jobId,
          resource_name: (payload as any).title ?? null,
          previous_data: claimed,
          new_data: { status: 'failed', error: r.error },
          severity: 'critical',
          undoable: false,
          scope_state_ids: Array.isArray((payload as any)?.filters?.assigned_state_ids) ? (payload as any).filters.assigned_state_ids : [],
          scope_group_ids: Array.isArray((payload as any)?.filters?.group_ids) ? (payload as any).filters.group_ids.map((x: any) => String(x)) : [],
        });
        continue;
      }

      if ((r as any).preview) {
        await admin
          .from('scheduled_notifications')
          .update({ status: 'failed', attempt_count: attempt, last_error: 'Worker received preview response unexpectedly' })
          .eq('id', jobId);
        results.push({ id: jobId, ok: false, error: 'Worker received preview response unexpectedly' });
        continue;
      }

      const sentPatch = { status: 'sent', attempt_count: attempt, last_error: null, sent_at: new Date().toISOString() };
      await admin.from('scheduled_notifications').update(sentPatch).eq('id', jobId);
      results.push({ id: jobId, ok: true, broadcast_id: (r as any).broadcast_id ?? null });

      void logAdminAction({
        actor_user_id: (claimed as any).created_by ?? null,
        actor_role: String((claimed as any).created_role ?? 'unknown'),
        action_type: 'scheduled_notifications.sent',
        resource_type: 'scheduled_notifications',
        resource_id: jobId,
        resource_name: (payload as any).title ?? null,
        previous_data: claimed,
        new_data: sentPatch,
        severity: 'info',
        undoable: false,
        scope_state_ids: Array.isArray((payload as any)?.filters?.assigned_state_ids) ? (payload as any).filters.assigned_state_ids : [],
        scope_group_ids: Array.isArray((payload as any)?.filters?.group_ids) ? (payload as any).filters.group_ids.map((x: any) => String(x)) : [],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin.from('scheduled_notifications').update({ status: 'failed', attempt_count: attempt, last_error: msg }).eq('id', jobId);
      results.push({ id: jobId, ok: false, error: msg });
    }
  }

  return json({ ok: true, processed: results.length, results });
}

