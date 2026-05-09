import { createServiceRoleClient } from '@/lib/admin-gate';
import { logAdminAction } from '@/lib/audit/logAdminAction';
import { validateCronRequest } from '@/lib/cron-auth';
import { nowIso, resolveWorkerRuntime, staleIso } from '@/lib/workers/runtime';

export const runtime = 'nodejs';
const WORKER = resolveWorkerRuntime('api/jobs/process-scheduled-posts', {
  leaseMs: 10 * 60 * 1000,
  maxAttempts: 5,
  batchSize: 50,
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

  /**
   * Enterprise scheduling model:
   * 1) Select due + retry-eligible rows.
   * 2) Claim each row atomically with a lease (status + locked_at + locked_by).
   * 3) Publish only if the lease still belongs to this worker.
   *
   * This prevents overlapping cron runs from publishing the same row twice.
   */
  let due: any[] = [];
  {
    const r = await admin
      .from('posts')
      .select('id,title,scheduled_at,status,deleted_at,created_by,attempt_count,locked_at,locked_by')
      .is('deleted_at', null)
      .or(`and(status.eq.scheduled_publish,scheduled_at.lte.${dueNowIso},attempt_count.lt.${WORKER.maxAttempts}),and(status.eq.processing_publish,scheduled_at.lte.${dueNowIso},locked_at.lt.${staleLeaseIso},attempt_count.lt.${WORKER.maxAttempts})`)
      .order('scheduled_at', { ascending: true })
      .limit(WORKER.batchSize);

    if (
      r.error &&
      (isMissingColumnErr(r.error, 'status') ||
        isMissingColumnErr(r.error, 'deleted_at') ||
        isMissingColumnErr(r.error, 'created_by') ||
        isMissingColumnErr(r.error, 'attempt_count') ||
        isMissingColumnErr(r.error, 'locked_at') ||
        isMissingColumnErr(r.error, 'locked_by'))
    ) {
      // Backward-compatible fallback when locking columns aren't deployed yet.
      const r2 = await admin.from('posts').select('id,title,scheduled_at').lte('scheduled_at', dueNowIso).order('scheduled_at', { ascending: true }).limit(WORKER.batchSize);
      if (r2.error) return json({ error: r2.error.message }, 500);
      due = (r2.data ?? []) as any[];
    } else if (r.error) {
      return json({ error: r.error.message }, 500);
    } else {
      due = (r.data ?? []) as any[];
    }
  }

  const results: any[] = [];
  let claimedCount = 0;
  let reclaimedCount = 0;
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  for (const p of due) {
    const id = String(p?.id ?? '').trim();
    if (!id) continue;
    try {
      // 1) Atomic claim with strict predicates.
      const claimPatch: any = {
        status: 'processing_publish',
        locked_at: dueNowIso,
        locked_by: WORKER.workerId,
        last_error: null,
      };
      const claimRes = await admin
        .from('posts')
        .update(claimPatch)
        .eq('id', id)
        .is('deleted_at', null)
        .lte('scheduled_at', dueNowIso)
        .lt('attempt_count', WORKER.maxAttempts)
        .or(`status.eq.scheduled_publish,and(status.eq.processing_publish,locked_at.lt.${staleLeaseIso})`)
        .select('id,title,status,scheduled_at,created_by,attempt_count,locked_at,locked_by')
        .maybeSingle();

      if (claimRes.error) {
        // Legacy fallback path when lease columns aren't available in DB yet.
        if (
          isMissingColumnErr(claimRes.error, 'attempt_count') ||
          isMissingColumnErr(claimRes.error, 'locked_at') ||
          isMissingColumnErr(claimRes.error, 'locked_by') ||
          isMissingColumnErr(claimRes.error, 'status') ||
          isMissingColumnErr(claimRes.error, 'deleted_at')
        ) {
          let legacy = await admin
            .from('posts')
            .update({ status: 'published' })
            .eq('id', id)
            .eq('status', 'scheduled_publish')
            .is('deleted_at', null)
            .lte('scheduled_at', dueNowIso)
            .select('id,title,status,scheduled_at,created_by')
            .maybeSingle();
          // Older schema fallback: no status/deleted_at columns yet.
          if (
            legacy.error &&
            (isMissingColumnErr(legacy.error, 'status') || isMissingColumnErr(legacy.error, 'deleted_at'))
          ) {
            legacy = await admin
              .from('posts')
              .update({ scheduled_at: null })
              .eq('id', id)
              .lte('scheduled_at', dueNowIso)
              .select('id,title,scheduled_at,created_by')
              .maybeSingle();
          }
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
            action_type: 'post.published_scheduled',
            resource_type: 'posts',
            resource_id: String((legacy.data as any)?.id ?? id),
            resource_name: (legacy.data as any)?.title != null ? String((legacy.data as any).title) : null,
            previous_data: p,
            new_data: legacy.data,
            severity: 'info',
            undoable: false,
            metadata: (legacy.data as any)?.scheduled_at ? { scheduled_at: (legacy.data as any).scheduled_at, legacy_fallback: true } : { legacy_fallback: true },
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
        // Another worker won the race or row is no longer eligible.
        skippedCount++;
        results.push({ id, ok: true, skipped: true });
        continue;
      }
      claimedCount++;
      if (String((claimRes.data as any)?.status ?? '') === 'processing_publish' && String((p as any)?.status ?? '') === 'processing_publish') {
        reclaimedCount++;
      }

      const claimed = claimRes.data as any;
      const attempt = Number(claimed?.attempt_count ?? 0) + 1;

      // 2) Publish only if this worker still owns the lease (idempotent transition).
      const publishRes = await admin
        .from('posts')
        .update({
          status: 'published',
          published_at: dueNowIso,
          locked_at: null,
          locked_by: null,
          attempt_count: attempt,
          last_error: null,
        })
        .eq('id', id)
        .eq('status', 'processing_publish')
        .eq('locked_by', WORKER.workerId)
        .eq('locked_at', dueNowIso)
        .is('deleted_at', null)
        .lte('scheduled_at', dueNowIso)
        .select('id,title,status,scheduled_at,created_by,published_at')
        .maybeSingle();

      if (publishRes.error) {
        // Release lease for retry or dead-letter after max attempts.
        const terminalStatus = attempt >= WORKER.maxAttempts ? 'scheduled_publish_failed' : 'scheduled_publish';
        await admin
          .from('posts')
          .update({
            status: terminalStatus,
            locked_at: null,
            locked_by: null,
            attempt_count: attempt,
            last_error: publishRes.error.message,
          })
          .eq('id', id)
          .eq('status', 'processing_publish')
          .eq('locked_by', WORKER.workerId)
          .eq('locked_at', dueNowIso);
        failedCount++;
        results.push({ id, ok: false, error: publishRes.error.message, attempt, terminalStatus });
        continue;
      }

      if (!publishRes.data) {
        // Lost lease or already processed by another node.
        skippedCount++;
        results.push({ id, ok: true, skipped: true, reason: 'lease-lost-or-already-processed' });
        continue;
      }

      // Audit log emitted exactly once because publish transition is conditional/idempotent.
      const row = publishRes.data as any;
      void logAdminAction({
        actor_user_id: row?.created_by ? String(row.created_by) : null,
        actor_role: 'system',
        action_type: 'post.published_scheduled',
        resource_type: 'posts',
        resource_id: String(row?.id ?? id),
        resource_name: row?.title != null ? String(row.title) : null,
        previous_data: claimed,
        new_data: row,
        severity: 'info',
        undoable: false,
        metadata: row?.scheduled_at ? { scheduled_at: row.scheduled_at, attempt } : { attempt },
      });

      successCount++;
      results.push({ id, ok: true, attempt });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failedCount++;
      results.push({ id, ok: false, error: msg });
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

