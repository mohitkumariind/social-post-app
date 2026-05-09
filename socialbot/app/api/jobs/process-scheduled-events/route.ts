import { createServiceRoleClient } from '@/lib/admin-gate';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { validateCronRequest } from '@/lib/cron-auth';
import { computeExponentialBackoffMs, createLockToken, nowIso, resolveWorkerRuntime, staleIso } from '@/lib/workers/runtime';

export const runtime = 'nodejs';
const WORKER = resolveWorkerRuntime('api/jobs/process-scheduled-events', {
  leaseMs: 10 * 60 * 1000,
  maxAttempts: 5,
  batchSize: 50,
  maxRunMs: 45_000,
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

export async function POST(request: Request) {
  const cronAuth = validateCronRequest(request);
  if (!cronAuth.ok) return json({ error: cronAuth.error }, cronAuth.status);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const startedAt = Date.now();
  const dueNowIso = nowIso();
  const staleLeaseIso = staleIso(WORKER.leaseMs);
  let supportsLockToken = true;
  const logWorker = (event: string, meta: Record<string, unknown>) =>
    console.info(`[${event}]`, JSON.stringify({ worker: WORKER.workerId, ...meta }));
  console.info('[worker.process-scheduled-events.start]', JSON.stringify({
    worker: WORKER.workerId,
    batch_size: WORKER.batchSize,
    max_attempts: WORKER.maxAttempts,
    lease_ms: WORKER.leaseMs,
    max_run_ms: WORKER.maxRunMs,
  }));

  /**
   * Lease model mirrors scheduled posts:
   * - due scan includes stale processing leases,
   * - each row is atomically claimed,
   * - publish transition is conditional on current lease ownership.
   */
  let due: any[] = [];
  {
    const r = await admin
      .from('events')
      .select('id,name,status,scheduled_at,deleted_at,created_by,published_at,attempt_count,locked_at,locked_by')
      .is('deleted_at', null)
      .or(`and(status.eq.scheduled_publish,scheduled_at.lte.${dueNowIso},attempt_count.lt.${WORKER.maxAttempts}),and(status.eq.processing_publish,scheduled_at.lte.${dueNowIso},locked_at.lt.${staleLeaseIso},attempt_count.lt.${WORKER.maxAttempts})`)
      .order('scheduled_at', { ascending: true })
      .limit(WORKER.batchSize);

    if (
      r.error &&
      (isMissingColumnErr(r.error, 'attempt_count') || isMissingColumnErr(r.error, 'locked_at') || isMissingColumnErr(r.error, 'locked_by'))
    ) {
      const r2 = await admin
        .from('events')
        .select('id,name,status,scheduled_at,deleted_at,created_by,published_at')
        .eq('status', 'scheduled_publish')
        .is('deleted_at', null)
        .lte('scheduled_at', dueNowIso)
        .order('scheduled_at', { ascending: true })
        .limit(WORKER.batchSize);
      if (r2.error) {
        if (isMissingColumnErr(r2.error, 'scheduled_at') || isMissingColumnErr(r2.error, 'status')) {
          return json({ ok: true, processed: 0, skipped: true, reason: 'schema not deployed' });
        }
        return json({ error: r2.error.message }, 500);
      }
      due = (r2.data ?? []) as any[];
    } else if (r.error) {
      if (isMissingColumnErr(r.error, 'scheduled_at') || isMissingColumnErr(r.error, 'status')) {
        return json({ ok: true, processed: 0, skipped: true, reason: 'schema not deployed' });
      }
      return json({ error: r.error.message }, 500);
    } else {
      due = (r.data ?? []) as any[];
    }
  }
  const { count: queueDepth } = await admin
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'scheduled_publish')
    .is('deleted_at', null);

  const results: any[] = [];
  let claimedCount = 0;
  let reclaimedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let retriedCount = 0;
  let exhaustedCount = 0;
  let lostLockCount = 0;

  for (const ev of due) {
    if (Date.now() - startedAt > WORKER.maxRunMs) break;
    const id = String(ev?.id ?? '').trim();
    if (!id) continue;
    const lockToken = createLockToken(WORKER.workerId, id);
    // 1) Claim row with lease ownership.
    let claimRes = await admin
      .from('events')
      .update({
        status: 'processing_publish',
        locked_at: dueNowIso,
        locked_by: WORKER.workerId,
        lock_token: lockToken,
        last_error: null,
      })
      .eq('id', id)
      .is('deleted_at', null)
      .lte('scheduled_at', dueNowIso)
      .lt('attempt_count', WORKER.maxAttempts)
      .or(`status.eq.scheduled_publish,and(status.eq.processing_publish,locked_at.lt.${staleLeaseIso})`)
      .select('id,name,status,scheduled_at,created_by,published_at,attempt_count,locked_at,locked_by,lock_token')
      .maybeSingle();
    if (claimRes.error && isMissingColumnErr(claimRes.error, 'lock_token')) {
      supportsLockToken = false;
      claimRes = await admin
        .from('events')
        .update({
          status: 'processing_publish',
          locked_at: dueNowIso,
          locked_by: WORKER.workerId,
          last_error: null,
        })
        .eq('id', id)
        .is('deleted_at', null)
        .lte('scheduled_at', dueNowIso)
        .lt('attempt_count', WORKER.maxAttempts)
        .or(`status.eq.scheduled_publish,and(status.eq.processing_publish,locked_at.lt.${staleLeaseIso})`)
        .select('id,name,status,scheduled_at,created_by,published_at,attempt_count,locked_at,locked_by')
        .maybeSingle();
    }

    if (claimRes.error) {
      // Backward-compatible fallback for older schemas.
      if (
        isMissingColumnErr(claimRes.error, 'attempt_count') ||
        isMissingColumnErr(claimRes.error, 'locked_at') ||
        isMissingColumnErr(claimRes.error, 'locked_by') ||
        isMissingColumnErr(claimRes.error, 'last_error')
      ) {
        const legacy = await admin
          .from('events')
          .update({ status: 'published', published_at: dueNowIso })
          .eq('id', id)
          .eq('status', 'scheduled_publish')
          .is('deleted_at', null)
          .lte('scheduled_at', dueNowIso)
          .select('id,name,status,scheduled_at,created_by,published_at')
          .maybeSingle();
        if (legacy.error) {
          failedCount++;
          results.push({ id, ok: false, error: legacy.error.message });
          continue;
        }
        if (!legacy.data) {
          skippedCount++;
          results.push({ id, ok: true, skipped: true });
          continue;
        }
        void logAdminAction({
          actor_user_id: (legacy.data as any)?.created_by ? String((legacy.data as any).created_by) : null,
          actor_role: 'system',
          action_type: 'event.published_scheduled',
          resource_type: 'events',
          resource_id: String((legacy.data as any)?.id ?? id),
          resource_name: (legacy.data as any)?.name != null ? String((legacy.data as any).name) : null,
          previous_data: ev,
          new_data: legacy.data,
          severity: 'info',
          undoable: false,
          metadata: (legacy.data as any)?.scheduled_at
            ? { scheduled_at: (legacy.data as any).scheduled_at, legacy_fallback: true }
            : { legacy_fallback: true },
        });
        successCount++;
        results.push({ id, ok: true, legacy_fallback: true });
        continue;
      }
      failedCount++;
      results.push({ id, ok: false, error: claimRes.error.message });
      continue;
    }
    if (!claimRes.data) {
      skippedCount++;
      results.push({ id, ok: true, skipped: true });
      continue;
    }
    claimedCount++;
    if (String((ev as any)?.status ?? '') === 'processing_publish') {
      reclaimedCount++;
      logWorker('worker.lock.reclaimed', { id });
    } else {
      logWorker('worker.lock.claimed', { id });
    }

    const claimed = claimRes.data as any;
    const attempt = Number(claimed?.attempt_count ?? 0) + 1;

    // 2) Publish only when the lease is still ours.
    let publishQ = admin
      .from('events')
      .update({
        status: 'published',
        published_at: dueNowIso,
        attempt_count: attempt,
        locked_at: null,
        locked_by: null,
        last_error: null,
      })
      .eq('id', id)
      .eq('status', 'processing_publish')
      .eq('locked_by', WORKER.workerId)
      .eq('locked_at', dueNowIso)
      .is('deleted_at', null)
      .lte('scheduled_at', dueNowIso)
      .select('id,name,status,scheduled_at,created_by,published_at');
    if (supportsLockToken) publishQ = publishQ.eq('lock_token', lockToken);
    const publishRes = await publishQ.maybeSingle();
    if (publishRes.error && isMissingColumnErr(publishRes.error, 'lock_token')) {
      supportsLockToken = false;
    }

    if (publishRes.error) {
      const retryAt = new Date(Date.now() + computeExponentialBackoffMs(attempt)).toISOString();
      const retryPatch =
        attempt >= WORKER.maxAttempts
          ? {
              status: 'scheduled_publish_failed',
              attempt_count: attempt,
              last_error: publishRes.error.message,
              locked_at: null,
              locked_by: null,
            }
          : {
              status: 'scheduled_publish',
              attempt_count: attempt,
              last_error: publishRes.error.message,
              locked_at: null,
              locked_by: null,
              scheduled_at: retryAt,
            };
      let retryQ = admin
        .from('events')
        .update(retryPatch)
        .eq('id', id)
        .eq('status', 'processing_publish')
        .eq('locked_by', WORKER.workerId)
        .eq('locked_at', dueNowIso);
      if (supportsLockToken) retryQ = retryQ.eq('lock_token', lockToken);
      await retryQ;
      if (retryPatch.status === 'scheduled_publish') {
        retriedCount++;
        logWorker('worker.retry.scheduled', { id, attempt, next_retry_at: retryAt });
      } else {
        exhaustedCount++;
        logWorker('worker.retry.exhausted', { id, attempt });
      }
      failedCount++;
      results.push({ id, ok: false, error: publishRes.error.message, attempt });
      continue;
    }
    if (!publishRes.data) {
      skippedCount++;
      lostLockCount++;
      logWorker('worker.lock.lost', { id });
      results.push({ id, ok: true, skipped: true, reason: 'lease-lost-or-already-processed' });
      continue;
    }

    void logAdminAction({
      actor_user_id: (publishRes.data as any)?.created_by ? String((publishRes.data as any).created_by) : null,
      actor_role: 'system',
      action_type: 'event.published_scheduled',
      resource_type: 'events',
      resource_id: String((publishRes.data as any)?.id ?? id),
      resource_name: (publishRes.data as any)?.name != null ? String((publishRes.data as any).name) : null,
      previous_data: claimed,
      new_data: publishRes.data,
      severity: 'info',
      undoable: false,
      metadata: (publishRes.data as any)?.scheduled_at ? { scheduled_at: (publishRes.data as any).scheduled_at, attempt } : { attempt },
    });

    successCount++;
    logWorker('worker.lock.completed', { id });
    results.push({ id, ok: true, attempt });
  }

  const payload = {
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
      retried: retriedCount,
      retry_exhausted: exhaustedCount,
      lock_lost: lostLockCount,
      queue_depth: typeof queueDepth === 'number' ? queueDepth : null,
      supports_lock_token: supportsLockToken,
      batch_size: WORKER.batchSize,
      max_attempts: WORKER.maxAttempts,
      lease_ms: WORKER.leaseMs,
      max_run_ms: WORKER.maxRunMs,
    },
    results,
  };
  console.info('[worker.process-scheduled-events.done]', JSON.stringify(payload));
  return json(payload);
}

