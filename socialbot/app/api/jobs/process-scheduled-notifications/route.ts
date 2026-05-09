import Expo from 'expo-server-sdk';
import { createServiceRoleClient } from '@/lib/admin-gate';
import { runBroadcast, type BroadcastPayload } from '@/lib/broadcast-send';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { canAccessResource } from '@/lib/rbac/unified-scope-engine';
import { validateCronRequest } from '@/lib/cron-auth';
import { computeExponentialBackoffMs, nowIso, resolveWorkerRuntime, staleIso } from '@/lib/workers/runtime';

export const runtime = 'nodejs';
const WORKER = resolveWorkerRuntime('api/jobs/process-scheduled-notifications', {
  leaseMs: 10 * 60 * 1000,
  maxAttempts: 5,
  batchSize: 10,
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function isMissingColumnErr(err: { message?: string } | null | undefined, columnName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column'));
}

async function renewLease(
  admin: any,
  jobId: string,
  currentLockedAt: string
): Promise<string | null> {
  const nextLockedAt = nowIso();
  const { data, error } = await admin
    .from('scheduled_notifications')
    .update({ locked_at: nextLockedAt })
    .eq('id', jobId)
    .eq('status', 'processing')
    .eq('locked_by', WORKER.workerId)
    .eq('locked_at', currentLockedAt)
    .select('id,locked_at')
    .maybeSingle();
  if (error || !data) return null;
  return String((data as any).locked_at ?? nextLockedAt);
}

export async function POST(request: Request) {
  const cronAuth = validateCronRequest(request);
  if (!cronAuth.ok) return json({ error: cronAuth.error }, cronAuth.status);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const startedAt = Date.now();
  const dueNowIso = nowIso();
  const staleLeaseIso = staleIso(WORKER.leaseMs);

  const { data: due, error } = await admin
    .from('scheduled_notifications')
    .select('*')
    // include stale processing jobs so they can be reclaimed
    .or(`and(status.in.(pending,failed),scheduled_at.lte.${dueNowIso},attempt_count.lt.${WORKER.maxAttempts}),and(status.eq.processing,locked_at.lt.${staleLeaseIso},attempt_count.lt.${WORKER.maxAttempts})`)
    .order('scheduled_at', { ascending: true })
    .limit(WORKER.batchSize);
  if (error) return json({ error: error.message }, 500);

  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const expo = new Expo(accessToken ? { accessToken } : undefined);

  const results: any[] = [];
  let claimedCount = 0;
  let reclaimedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  for (const job of due ?? []) {
    const jobId = String((job as any).id ?? '');
    if (!jobId) continue;

    // Claim lock (best-effort)
    const claim = {
      status: 'processing',
      locked_at: nowIso(),
      locked_by: WORKER.workerId,
    };
    const { data: claimed, error: claimErr } = await admin
      .from('scheduled_notifications')
      .update(claim)
      .eq('id', jobId)
      .lt('attempt_count', WORKER.maxAttempts)
      .or(`status.in.(pending,failed),and(status.eq.processing,locked_at.lt.${staleLeaseIso})`)
      .select('*')
      .maybeSingle();
    if (claimErr || !claimed) continue;
    let claimLockedAt = String((claimed as any).locked_at ?? '');
    claimedCount++;
    if (String((job as any)?.status ?? '') === 'processing') reclaimedCount++;

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
          .update({ status: 'cancelled', last_error: 'Duplicate idempotency_key already sent', locked_at: null, locked_by: null })
          .eq('id', jobId)
          .eq('status', 'processing')
          .eq('locked_by', WORKER.workerId)
          .eq('locked_at', claimLockedAt);
        skippedCount++;
        results.push({ id: jobId, ok: true, skipped: true, reason: 'duplicate idempotency_key already sent' });
        continue;
      }
    }

    const attempt = Number((claimed as any).attempt_count ?? 0) + 1;
    const nextRetryAt = new Date(Date.now() + computeExponentialBackoffMs(attempt)).toISOString();
    const terminalFailureStatus = attempt >= WORKER.maxAttempts ? 'cancelled' : 'pending';
    const existingBroadcastId = String((claimed as any).broadcast_id ?? '').trim();
    const payload = ((claimed as any).payload ?? null) as BroadcastPayload | null;
    if (!payload) {
      const failurePatch =
        terminalFailureStatus === 'cancelled'
          ? { status: terminalFailureStatus, attempt_count: attempt, last_error: 'Missing payload', locked_at: null, locked_by: null }
          : {
              status: terminalFailureStatus,
              attempt_count: attempt,
              last_error: 'Missing payload',
              locked_at: null,
              locked_by: null,
              scheduled_at: nextRetryAt,
            };
      await admin
        .from('scheduled_notifications')
        .update(failurePatch)
        .eq('id', jobId)
        .eq('status', 'processing')
        .eq('locked_by', WORKER.workerId)
        .eq('locked_at', claimLockedAt);
      failedCount++;
      results.push({ id: jobId, ok: false, error: 'Missing payload' });
      continue;
    }

    try {
      // Renew lease before potentially long broadcast send to reduce premature stale reclaim.
      const renewed = await renewLease(admin, jobId, claimLockedAt);
      if (!renewed) {
        skippedCount++;
        results.push({ id: jobId, ok: true, skipped: true, reason: 'lease-lost-before-send' });
        continue;
      }
      claimLockedAt = renewed;

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

        if (
          !canAccessResource(user as any, resource as any, {
            resourceType: 'scheduled_notifications',
            audit: {
              resourceType: 'scheduled_notifications',
              action: 'scheduled_notifications.process.scope_validate',
              resourceId: jobId,
              resourceName: String((payload as any).title ?? ''),
            },
          })
        ) {
          await admin
            .from('scheduled_notifications')
            .update({
              status: 'cancelled',
              attempt_count: attempt,
              last_error: 'Forbidden: payload target outside creator scope',
              locked_at: null,
              locked_by: null,
            })
            .eq('id', jobId)
            .eq('status', 'processing')
            .eq('locked_by', WORKER.workerId)
            .eq('locked_at', claimLockedAt);
          failedCount++;
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
      const r = await runBroadcast(admin, expo, payloadToSend, {
        existing_broadcast_id: existingBroadcastId || null,
        skip_history_insert: Boolean(existingBroadcastId),
      });
      if (!r.ok) {
        const failurePatch =
          terminalFailureStatus === 'cancelled'
            ? { status: terminalFailureStatus, attempt_count: attempt, last_error: r.error, locked_at: null, locked_by: null }
            : {
                status: terminalFailureStatus,
                attempt_count: attempt,
                last_error: r.error,
                locked_at: null,
                locked_by: null,
                scheduled_at: nextRetryAt,
              };
        const patchWithBroadcastId = (r as any).broadcast_id
          ? { ...failurePatch, broadcast_id: String((r as any).broadcast_id) }
          : failurePatch;
        const failureUpdate = await admin
          .from('scheduled_notifications')
          .update(patchWithBroadcastId)
          .eq('id', jobId)
          .eq('status', 'processing')
          .eq('locked_by', WORKER.workerId)
          .eq('locked_at', claimLockedAt);
        if (failureUpdate.error && isMissingColumnErr(failureUpdate.error, 'broadcast_id')) {
          await admin
            .from('scheduled_notifications')
            .update(failurePatch)
            .eq('id', jobId)
            .eq('status', 'processing')
            .eq('locked_by', WORKER.workerId)
            .eq('locked_at', claimLockedAt);
        }
        failedCount++;
        results.push({ id: jobId, ok: false, error: r.error, attempt, next_retry_at: terminalFailureStatus === 'pending' ? nextRetryAt : null });

        void logAdminAction({
          actor_user_id: (claimed as any).created_by ?? null,
          actor_role: String((claimed as any).created_role ?? 'unknown'),
          action_type: 'scheduled_notifications.failed',
          resource_type: 'scheduled_notifications',
          resource_id: jobId,
          resource_name: (payload as any).title ?? null,
          previous_data: claimed,
          new_data: { status: terminalFailureStatus, error: r.error, attempt, next_retry_at: terminalFailureStatus === 'pending' ? nextRetryAt : null },
          severity: 'critical',
          undoable: false,
          scope_state_ids: Array.isArray((payload as any)?.filters?.assigned_state_ids) ? (payload as any).filters.assigned_state_ids : [],
          scope_group_ids: Array.isArray((payload as any)?.filters?.group_ids) ? (payload as any).filters.group_ids.map((x: any) => String(x)) : [],
        });
        continue;
      }

      if ((r as any).preview) {
        const previewErr = 'Worker received preview response unexpectedly';
        const failurePatch =
          terminalFailureStatus === 'cancelled'
            ? { status: terminalFailureStatus, attempt_count: attempt, last_error: previewErr, locked_at: null, locked_by: null }
            : {
                status: terminalFailureStatus,
                attempt_count: attempt,
                last_error: previewErr,
                locked_at: null,
                locked_by: null,
                scheduled_at: nextRetryAt,
              };
        await admin
          .from('scheduled_notifications')
          .update(failurePatch)
          .eq('id', jobId)
          .eq('status', 'processing')
          .eq('locked_by', WORKER.workerId)
          .eq('locked_at', claimLockedAt);
        failedCount++;
        results.push({ id: jobId, ok: false, error: previewErr, attempt, next_retry_at: terminalFailureStatus === 'pending' ? nextRetryAt : null });
        continue;
      }

      const sentPatch = {
        status: 'sent',
        attempt_count: attempt,
        last_error: null,
        sent_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        broadcast_id: String((r as any).broadcast_id ?? existingBroadcastId ?? ''),
      };
      const sentUpdate = await admin
        .from('scheduled_notifications')
        .update(sentPatch)
        .eq('id', jobId)
        .eq('status', 'processing')
        .eq('locked_by', WORKER.workerId)
        .eq('locked_at', claimLockedAt);
      if (sentUpdate.error && isMissingColumnErr(sentUpdate.error, 'broadcast_id')) {
        const sentFallbackPatch = {
          status: 'sent',
          attempt_count: attempt,
          last_error: null,
          sent_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
        };
        await admin
          .from('scheduled_notifications')
          .update(sentFallbackPatch)
          .eq('id', jobId)
          .eq('status', 'processing')
          .eq('locked_by', WORKER.workerId)
          .eq('locked_at', claimLockedAt);
      }
      successCount++;
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
      const failurePatch =
        terminalFailureStatus === 'cancelled'
          ? { status: terminalFailureStatus, attempt_count: attempt, last_error: msg, locked_at: null, locked_by: null }
          : {
              status: terminalFailureStatus,
              attempt_count: attempt,
              last_error: msg,
              locked_at: null,
              locked_by: null,
              scheduled_at: nextRetryAt,
            };
      await admin
        .from('scheduled_notifications')
        .update(failurePatch)
        .eq('id', jobId)
        .eq('status', 'processing')
        .eq('locked_by', WORKER.workerId)
        .eq('locked_at', claimLockedAt);
      failedCount++;
      results.push({ id: jobId, ok: false, error: msg, attempt, next_retry_at: terminalFailureStatus === 'pending' ? nextRetryAt : null });
    }
  }

  return json({
    ok: true,
    processed: results.length,
    worker: WORKER.workerId,
    duration_ms: Date.now() - startedAt,
    metrics: {
      claimed: claimedCount,
      reclaimed_stale: reclaimedCount,
      succeeded: successCount,
      failed: failedCount,
      skipped: skippedCount,
      batch_size: WORKER.batchSize,
      max_attempts: WORKER.maxAttempts,
      lease_ms: WORKER.leaseMs,
    },
    results,
  });
}

