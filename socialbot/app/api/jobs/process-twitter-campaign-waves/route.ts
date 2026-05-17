import { createServiceRoleClient } from '@/lib/admin-gate';
import { validateCronRequest } from '@/lib/cron-auth';
import {
  fetchEligibleProfileIdsPage,
  isMissingColumnErr,
  loadCampaignForWave,
  nextWaveBatchIndex,
  resolveTwitterWaveMaxBatchesPerRun,
  resolveTwitterWaveUserPageSize,
  type TwitterWaveRow,
} from '@/lib/twitter-campaign-wave-worker';
import { createLockToken, nowIso, resolveWorkerRuntime, staleIso } from '@/lib/workers/runtime';

export const runtime = 'nodejs';

const WORKER = resolveWorkerRuntime('api/jobs/process-twitter-campaign-waves', {
  leaseMs: 8 * 60 * 1000,
  maxAttempts: 8,
  batchSize: 4,
  maxRunMs: 55_000,
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function logWorker(event: string, meta: Record<string, unknown>) {
  console.info(`[${event}]`, JSON.stringify({ worker: WORKER.workerId, ...meta }));
}

export async function POST(request: Request) {
  const cronAuth = validateCronRequest(request);
  if (!cronAuth.ok) return json({ error: cronAuth.error }, cronAuth.status);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const startedAt = Date.now();
  const dueNowIso = nowIso();
  const staleLeaseIso = staleIso(WORKER.leaseMs);
  const userPageSize = resolveTwitterWaveUserPageSize();
  const maxBatchesPerWave = resolveTwitterWaveMaxBatchesPerRun();

  logWorker('worker.process-twitter-campaign-waves.start', {
    batch_size: WORKER.batchSize,
    max_attempts: WORKER.maxAttempts,
    lease_ms: WORKER.leaseMs,
    max_run_ms: WORKER.maxRunMs,
    user_page_size: userPageSize,
    max_batches_per_wave: maxBatchesPerWave,
  });

  const [{ count: pendingWaveCount }, { count: runningWaveCount }, { count: outboxQueueCount }] =
    await Promise.all([
      admin
        .from('twitter_campaign_waves')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      admin
        .from('twitter_campaign_waves')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'running'),
      admin
        .from('notification_outbox')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'failed', 'processing']),
    ]);

  logWorker('worker.twitter.pipeline.snapshot', {
    pending_waves: pendingWaveCount ?? 0,
    running_waves: runningWaveCount ?? 0,
    outbox_rows: outboxQueueCount ?? 0,
    due_now_iso: dueNowIso,
  });

  const { data: dueRows, error: dueErr } = await admin
    .from('twitter_campaign_waves')
    .select(
      'id,campaign_id,wave_index,scheduled_at,status,locked_at,locked_by,attempt_count,lock_token,staging_after_user_id,started_at'
    )
    .or(
      `and(status.eq.pending,scheduled_at.lte.${dueNowIso}),and(status.eq.running,locked_at.lt.${staleLeaseIso})`
    )
    .order('scheduled_at', { ascending: true })
    .limit(WORKER.batchSize);

  if (dueErr) {
    if (isMissingColumnErr(dueErr, 'lock_token') || isMissingColumnErr(dueErr, 'staging_after_user_id')) {
      return json(
        {
          error: 'twitter_campaign_waves worker columns missing; apply migration 20260513140000_twitter_campaign_wave_worker.sql',
          detail: dueErr.message,
        },
        503
      );
    }
    return json({ error: dueErr.message }, 500);
  }

  const candidates = (dueRows ?? []) as TwitterWaveRow[];
  logWorker('worker.twitter.waves.due', {
    due_count: candidates.length,
    wave_ids: candidates.map((w) => w.id),
    campaign_ids: [...new Set(candidates.map((w) => w.campaign_id))],
    scheduled_at: candidates.map((w) => ({ id: w.id, at: w.scheduled_at, status: w.status })),
  });
  const results: Record<string, unknown>[] = [];
  let claimed = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let batchesInserted = 0;
  let assignmentsInserted = 0;
  let assignmentsSkippedExhausted = 0;
  let assignmentsSkippedDuplicate = 0;

  for (const w of candidates) {
    if (Date.now() - startedAt > WORKER.maxRunMs) break;
    const waveId = String(w.id ?? '').trim();
    const campaignId = String(w.campaign_id ?? '').trim();
    if (!waveId || !campaignId) continue;

    let campaign: Awaited<ReturnType<typeof loadCampaignForWave>>;
    try {
      campaign = await loadCampaignForWave(admin, campaignId);
    } catch (e) {
      failed++;
      results.push({ wave_id: waveId, ok: false, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    if (!campaign || campaign.status !== 'published') {
      skipped++;
      results.push({ wave_id: waveId, ok: true, skipped: true, reason: 'campaign_not_published' });
      continue;
    }

    if (w.status === 'pending' && (w.attempt_count ?? 0) >= WORKER.maxAttempts) {
      const { error: deadErr } = await admin
        .from('twitter_campaign_waves')
        .update({
          status: 'failed',
          last_error: 'max_attempts_exhausted',
          locked_at: null,
          locked_by: null,
          lock_token: null,
        })
        .eq('id', waveId)
        .eq('status', 'pending');
      if (deadErr) {
        failed++;
        results.push({ wave_id: waveId, ok: false, error: deadErr.message });
      } else {
        failed++;
        results.push({ wave_id: waveId, ok: false, terminal: 'max_attempts_exhausted' });
      }
      continue;
    }

    const lockToken = createLockToken(WORKER.workerId, waveId);
    let claimRes: { data: TwitterWaveRow | null; error: { message: string } | null };

    if (w.status === 'pending') {
      const nextAttempt = (w.attempt_count ?? 0) + 1;
      claimRes = await admin
        .from('twitter_campaign_waves')
        .update({
          status: 'running',
          locked_at: dueNowIso,
          locked_by: WORKER.workerId,
          lock_token: lockToken,
          attempt_count: nextAttempt,
          started_at: w.started_at ?? dueNowIso,
          staging_after_user_id: null,
          last_error: null,
        })
        .eq('id', waveId)
        .eq('status', 'pending')
        .lte('scheduled_at', dueNowIso)
        .select('id,campaign_id,wave_index,scheduled_at,status,locked_at,locked_by,attempt_count,lock_token,staging_after_user_id,started_at')
        .maybeSingle();
    } else {
      claimRes = await admin
        .from('twitter_campaign_waves')
        .update({
          locked_at: dueNowIso,
          locked_by: WORKER.workerId,
          lock_token: lockToken,
          last_error: null,
        })
        .eq('id', waveId)
        .eq('status', 'running')
        .lt('locked_at', staleLeaseIso)
        .select('id,campaign_id,wave_index,scheduled_at,status,locked_at,locked_by,attempt_count,lock_token,staging_after_user_id,started_at')
        .maybeSingle();
    }

    if (claimRes.error) {
      failed++;
      results.push({ wave_id: waveId, ok: false, error: claimRes.error.message });
      continue;
    }
    if (!claimRes.data) {
      skipped++;
      results.push({ wave_id: waveId, ok: true, skipped: true, reason: 'claim_lost_or_not_eligible' });
      continue;
    }

    claimed++;
    const claimedWave = claimRes.data as TwitterWaveRow;
    logWorker('worker.twitter_wave.claimed', {
      wave_id: waveId,
      status: claimedWave.status,
      campaign_id: campaignId,
      target_party: campaign?.target_party ?? null,
    });

    let campaignFresh: Awaited<ReturnType<typeof loadCampaignForWave>>;
    try {
      campaignFresh = await loadCampaignForWave(admin, campaignId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from('twitter_campaign_waves')
        .update({
          status: 'failed',
          last_error: `campaign_reload:${msg}`.slice(0, 2000),
          locked_at: null,
          locked_by: null,
          lock_token: null,
        })
        .eq('id', waveId)
        .eq('status', 'running')
        .eq('locked_by', WORKER.workerId)
        .eq('lock_token', lockToken);
      failed++;
      results.push({ wave_id: waveId, ok: false, error: msg });
      continue;
    }
    if (!campaignFresh || campaignFresh.status !== 'published') {
      await admin
        .from('twitter_campaign_waves')
        .update({
          status: 'cancelled',
          last_error: 'campaign_not_published',
          locked_at: null,
          locked_by: null,
          lock_token: null,
          completed_at: null,
        })
        .eq('id', waveId)
        .eq('status', 'running')
        .eq('locked_by', WORKER.workerId)
        .eq('lock_token', lockToken);
      skipped++;
      results.push({ wave_id: waveId, ok: true, skipped: true, reason: 'campaign_not_published_after_claim' });
      continue;
    }

    let batchIndex = await nextWaveBatchIndex(admin, waveId);
    let cursor: string | null = claimedWave.staging_after_user_id ?? null;
    let batchesThisInvocation = 0;
    let terminalOk = false;

    try {
      while (batchesThisInvocation < maxBatchesPerWave && Date.now() - startedAt < WORKER.maxRunMs) {
        const { ids, nextAfter } = await fetchEligibleProfileIdsPage(admin, campaignFresh.target_party, {
          afterUserId: cursor,
          limit: userPageSize,
        });

        if (ids.length === 0) {
          const doneIso = nowIso();
          const fin = await admin
            .from('twitter_campaign_waves')
            .update({
              status: 'completed',
              completed_at: doneIso,
              locked_at: null,
              locked_by: null,
              lock_token: null,
              staging_after_user_id: null,
              last_error: null,
            })
            .eq('id', waveId)
            .eq('status', 'running')
            .eq('locked_by', WORKER.workerId)
            .eq('lock_token', lockToken)
            .select('id')
            .maybeSingle();
          if (fin.error) throw new Error(fin.error.message);
          terminalOk = true;
          completed++;
          logWorker('worker.twitter_wave.completed', { wave_id: waveId, batches: batchesThisInvocation, empty_page: true });
          results.push({
            wave_id: waveId,
            ok: true,
            completed: true,
            batches: batchesThisInvocation,
            reason: 'no_eligible_profiles',
          });
          break;
        }

        const { data: assignStats, error: assignErr } = await admin.rpc('twitter_campaign_assign_unseen_for_users', {
          p_wave_id: waveId,
          p_campaign_id: campaignId,
          p_user_ids: ids,
        });
        if (assignErr) throw new Error(assignErr.message);
        const stats = (assignStats ?? {}) as Record<string, unknown>;
        assignmentsInserted += Number(stats.inserted ?? 0);
        assignmentsSkippedExhausted += Number(stats.skipped_exhausted ?? 0);
        assignmentsSkippedDuplicate += Number(stats.skipped_duplicate ?? 0);
        logWorker('worker.twitter_wave.assignments', {
          wave_id: waveId,
          page_users: ids.length,
          inserted: stats.inserted,
          skipped_exhausted: stats.skipped_exhausted,
          skipped_duplicate: stats.skipped_duplicate,
        });

        let enqErr: { message: string } | null = null;
        let enqCount: unknown = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await admin.rpc('twitter_campaign_enqueue_notification_outbox', { p_wave_id: waveId });
          enqErr = res.error;
          enqCount = res.data;
          if (!enqErr) break;
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
        if (enqErr) {
          throw new Error(`twitter_campaign_enqueue_notification_outbox: ${enqErr.message}`);
        }
        logWorker('worker.twitter_wave.outbox_enqueue', { wave_id: waveId, rows: enqCount });

        const ins = await admin.from('twitter_campaign_wave_batches').insert({
          wave_id: waveId,
          batch_index: batchIndex,
          status: 'prepared',
          profile_ids: ids,
        } as any);
        if (ins.error) throw new Error(ins.error.message);
        batchesInserted++;
        batchesThisInvocation++;
        batchIndex += 1;

        const lastId = ids[ids.length - 1]!;
        cursor = lastId;

        const leaseBump = await admin
          .from('twitter_campaign_waves')
          .update({
            staging_after_user_id: lastId,
            locked_at: nowIso(),
          })
          .eq('id', waveId)
          .eq('status', 'running')
          .eq('locked_by', WORKER.workerId)
          .eq('lock_token', lockToken)
          .select('id')
          .maybeSingle();
        if (leaseBump.error) throw new Error(leaseBump.error.message);
        if (!leaseBump.data) throw new Error('lost_lock_during_staging');

        if (!nextAfter) {
          const fin = await admin
            .from('twitter_campaign_waves')
            .update({
              status: 'completed',
              completed_at: nowIso(),
              locked_at: null,
              locked_by: null,
              lock_token: null,
              staging_after_user_id: null,
              last_error: null,
            })
            .eq('id', waveId)
            .eq('status', 'running')
            .eq('locked_by', WORKER.workerId)
            .eq('lock_token', lockToken)
            .select('id')
            .maybeSingle();
          if (fin.error) throw new Error(fin.error.message);
          terminalOk = true;
          completed++;
          logWorker('worker.twitter_wave.completed', { wave_id: waveId, batches: batchesThisInvocation });
          results.push({ wave_id: waveId, ok: true, completed: true, batches: batchesThisInvocation });
          break;
        }
      }

      if (!terminalOk && batchesThisInvocation >= maxBatchesPerWave) {
        const ext = await admin
          .from('twitter_campaign_waves')
          .update({
            locked_at: nowIso(),
            last_error: 'staging_paused_time_or_batch_budget',
          })
          .eq('id', waveId)
          .eq('status', 'running')
          .eq('locked_by', WORKER.workerId)
          .eq('lock_token', lockToken)
          .select('id')
          .maybeSingle();
        if (ext.error) throw new Error(ext.error.message);
        logWorker('worker.twitter_wave.staging_paused', { wave_id: waveId, batches: batchesThisInvocation });
        results.push({
          wave_id: waveId,
          ok: true,
          paused: true,
          batches_this_run: batchesThisInvocation,
        });
      } else if (!terminalOk) {
        const ext = await admin
          .from('twitter_campaign_waves')
          .update({ locked_at: nowIso(), last_error: 'staging_paused_global_time_budget' })
          .eq('id', waveId)
          .eq('status', 'running')
          .eq('locked_by', WORKER.workerId)
          .eq('lock_token', lockToken);
        if (ext.error) throw new Error(ext.error.message);
        results.push({ wave_id: waveId, ok: true, paused: true, reason: 'global_time_budget' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin
        .from('twitter_campaign_waves')
        .update({
          status: 'failed',
          last_error: msg.slice(0, 2000),
          locked_at: null,
          locked_by: null,
          lock_token: null,
        })
        .eq('id', waveId)
        .eq('locked_by', WORKER.workerId)
        .eq('status', 'running');
      failed++;
      logWorker('worker.twitter_wave.failed', { wave_id: waveId, error: msg });
      results.push({ wave_id: waveId, ok: false, error: msg });
    }
  }

  const payload = {
    ok: true,
    worker: WORKER.workerId,
    duration_ms: Date.now() - startedAt,
    metrics: {
      candidates: candidates.length,
      claimed,
      completed,
      failed,
      skipped,
      batches_inserted: batchesInserted,
      assignments_inserted: assignmentsInserted,
      assignments_skipped_exhausted: assignmentsSkippedExhausted,
      assignments_skipped_duplicate: assignmentsSkippedDuplicate,
      user_page_size: userPageSize,
      max_batches_per_wave: maxBatchesPerWave,
      lease_ms: WORKER.leaseMs,
      max_run_ms: WORKER.maxRunMs,
    },
    results,
  };
  logWorker('worker.process-twitter-campaign-waves.done', payload as any);
  return json(payload);
}
