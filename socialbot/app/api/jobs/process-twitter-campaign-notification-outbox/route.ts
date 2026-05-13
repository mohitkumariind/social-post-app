import Expo from 'expo-server-sdk';
import { createServiceRoleClient } from '@/lib/admin-gate';
import { validateCronRequest } from '@/lib/cron-auth';
import { TWITTER_CAMPAIGN_PUSH_DATA_TYPE } from '@/lib/twitter-campaign-push-constants';
import {
  computeExponentialBackoffMsWithJitter,
  createLockToken,
  nowIso,
  resolveWorkerRuntime,
  staleIso,
} from '@/lib/workers/runtime';
import { ANDROID_NOTIFICATION_CHANNEL_ID } from '../../../../../lib/pushChannel';

export const runtime = 'nodejs';

const WORKER = resolveWorkerRuntime('api/jobs/process-twitter-campaign-notification-outbox', {
  leaseMs: 5 * 60 * 1000,
  maxAttempts: 8,
  batchSize: 25,
  maxRunMs: 50_000,
});

function intFromEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function resolveTwitterPushCooldownMs(): number {
  return intFromEnv('TWITTER_PUSH_COOLDOWN_MS', 120_000, 5_000, 60 * 60 * 1000);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function logWorker(event: string, meta: Record<string, unknown>) {
  console.info(`[${event}]`, JSON.stringify({ worker: WORKER.workerId, ...meta }));
}

function shouldDeleteToken(detailsError: string, message: string): boolean {
  const e = String(detailsError ?? '');
  const m = String(message ?? '');
  if (e === 'DeviceNotRegistered' || /DeviceNotRegistered/i.test(m)) return true;
  if (/project/i.test(m) && /mismatch|different|same request|same project/i.test(m)) return true;
  return false;
}

function startOfUtcDayIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)).toISOString();
}

export async function POST(request: Request) {
  const cronAuth = validateCronRequest(request);
  if (!cronAuth.ok) return json({ error: cronAuth.error }, cronAuth.status);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const cooldownMs = resolveTwitterPushCooldownMs();
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  const expo = new Expo(accessToken ? { accessToken } : undefined);

  const startedAt = Date.now();
  const dueNowIso = nowIso();
  const staleLeaseIso = staleIso(WORKER.leaseMs);
  const log = (e: string, m: Record<string, unknown>) => logWorker(e, m);

  log('worker.process-twitter-campaign-notification-outbox.start', {
    batch_size: WORKER.batchSize,
    max_attempts: WORKER.maxAttempts,
    lease_ms: WORKER.leaseMs,
    max_run_ms: WORKER.maxRunMs,
    cooldown_ms: cooldownMs,
  });

  const { data: dueRows, error: dueErr } = await admin
    .from('notification_outbox')
    .select(
      'id,user_id,campaign_id,wave_id,assignment_id,payload,status,attempts,last_error,created_at,next_retry_at,locked_at,locked_by,lock_token,sent_at'
    )
    .or(
      `and(status.in.(pending,failed),next_retry_at.lte.${dueNowIso},attempts.lt.${WORKER.maxAttempts}),and(status.eq.processing,locked_at.lt.${staleLeaseIso},attempts.lt.${WORKER.maxAttempts})`
    )
    .order('next_retry_at', { ascending: true })
    .limit(WORKER.batchSize);

  if (dueErr) {
    const msg = String(dueErr.message ?? '').toLowerCase();
    if (msg.includes('notification_outbox') && (msg.includes('does not exist') || msg.includes('schema cache'))) {
      return json({ error: 'notification_outbox not installed', detail: dueErr.message }, 503);
    }
    return json({ error: dueErr.message }, 500);
  }

  const due = (dueRows ?? []) as any[];
  const results: Record<string, unknown>[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let cooldownDeferred = 0;
  let capDeferred = 0;
  let inactiveDeferred = 0;

  const campaignIds = [...new Set(due.map((r) => String(r?.campaign_id ?? '').trim()).filter(Boolean))];
  const campaignMeta = new Map<string, { status: string; maxCap: number }>();
  if (campaignIds.length > 0) {
    const { data: camps, error: campMetaErr } = await admin
      .from('twitter_campaigns')
      .select('id,status,max_push_per_user_per_day')
      .in('id', campaignIds);
    if (!campMetaErr && camps) {
      for (const row of camps as { id: string; status?: string; max_push_per_user_per_day?: number }[]) {
        const cid = String(row.id ?? '').trim();
        if (!cid) continue;
        const maxRaw = row.max_push_per_user_per_day;
        const maxCap = Number.isFinite(Number(maxRaw)) && Number(maxRaw) >= 0 ? Math.trunc(Number(maxRaw)) : 20;
        campaignMeta.set(cid, { status: String(row.status ?? ''), maxCap });
      }
    }
  }

  for (const row of due) {
    if (Date.now() - startedAt > WORKER.maxRunMs) break;
    const id = String(row?.id ?? '').trim();
    const userId = String(row?.user_id ?? '').trim();
    if (!id || !userId) continue;

    const lockToken = createLockToken(WORKER.workerId, id);
    const claimRes = await admin
      .from('notification_outbox')
      .update({
        status: 'processing',
        locked_at: dueNowIso,
        locked_by: WORKER.workerId,
        lock_token: lockToken,
      })
      .eq('id', id)
      .lt('attempts', WORKER.maxAttempts)
      .or(`status.in.(pending,failed),and(status.eq.processing,locked_at.lt.${staleLeaseIso})`)
      .select('*')
      .maybeSingle();

    if (claimRes.error || !claimRes.data) {
      skipped++;
      continue;
    }

    const claimed = claimRes.data as any;
    const attempt = Number(claimed.attempts ?? 0) + 1;

    const sinceIso = new Date(Date.now() - cooldownMs).toISOString();
    const { count: recentSent, error: coolErr } = await admin
      .from('notification_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'sent')
      .gte('sent_at', sinceIso);
    if (!coolErr && (recentSent ?? 0) > 0) {
      const deferUntil = new Date(Date.now() + cooldownMs).toISOString();
      await admin
        .from('notification_outbox')
        .update({
          status: 'pending',
          locked_at: null,
          locked_by: null,
          lock_token: null,
          next_retry_at: deferUntil,
          last_error: 'cooldown_deferred',
        })
        .eq('id', id)
        .eq('status', 'processing')
        .eq('locked_by', WORKER.workerId)
        .eq('lock_token', lockToken);
      cooldownDeferred++;
      results.push({ id, ok: true, deferred: 'cooldown' });
      continue;
    }

    const campaignIdForSend = String(claimed.campaign_id ?? '').trim();
    const meta = campaignIdForSend ? campaignMeta.get(campaignIdForSend) : undefined;
    if (meta && meta.status !== 'published') {
      const deferUntil = new Date(Date.now() + 60_000).toISOString();
      await admin
        .from('notification_outbox')
        .update({
          status: 'pending',
          locked_at: null,
          locked_by: null,
          lock_token: null,
          next_retry_at: deferUntil,
          last_error: 'campaign_not_active_deferred',
        })
        .eq('id', id)
        .eq('status', 'processing')
        .eq('locked_by', WORKER.workerId)
        .eq('lock_token', lockToken);
      inactiveDeferred++;
      results.push({ id, ok: true, deferred: 'campaign_inactive' });
      continue;
    }

    if (campaignIdForSend) {
      const maxCap = meta?.maxCap ?? 20;
      const dayStart = startOfUtcDayIso();
      const { count: sentToday, error: capErr } = await admin
        .from('notification_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('campaign_id', campaignIdForSend)
        .eq('status', 'sent')
        .gte('sent_at', dayStart);
      if (!capErr && (sentToday ?? 0) >= maxCap) {
        const deferUntil = new Date(Date.now() + 5 * 60_000).toISOString();
        await admin
          .from('notification_outbox')
          .update({
            status: 'pending',
            locked_at: null,
            locked_by: null,
            lock_token: null,
            next_retry_at: deferUntil,
            last_error: 'notification_cap_daily_deferred',
          })
          .eq('id', id)
          .eq('status', 'processing')
          .eq('locked_by', WORKER.workerId)
          .eq('lock_token', lockToken);
        capDeferred++;
        results.push({ id, ok: true, deferred: 'daily_cap' });
        continue;
      }
    }

    const { data: tokRow, error: tokErr } = await admin.from('push_tokens').select('token').eq('user_id', userId).maybeSingle();
    if (tokErr || !tokRow?.token || !Expo.isExpoPushToken(String(tokRow.token))) {
      const nextRetry = new Date(Date.now() + computeExponentialBackoffMsWithJitter(attempt)).toISOString();
      const terminal = attempt >= WORKER.maxAttempts;
      await admin
        .from('notification_outbox')
        .update({
          status: terminal ? 'failed' : 'pending',
          attempts: attempt,
          last_error: 'missing_or_invalid_push_token',
          locked_at: null,
          locked_by: null,
          lock_token: null,
          next_retry_at: terminal ? dueNowIso : nextRetry,
        })
        .eq('id', id)
        .eq('status', 'processing')
        .eq('locked_by', WORKER.workerId)
        .eq('lock_token', lockToken);
      failed++;
      results.push({ id, ok: false, error: 'no_token' });
      continue;
    }

    const token = String(tokRow.token).trim();
    const payload = (claimed.payload ?? {}) as Record<string, unknown>;
    const title = String(payload.title ?? 'Campaign').slice(0, 120);
    const body = String(payload.body ?? 'Tap to open').slice(0, 240);
    const campaignId = String(claimed.campaign_id ?? '').trim();
    const waveId = String(claimed.wave_id ?? '').trim();
    const assignmentId = String(claimed.assignment_id ?? '').trim();

    const msg = {
      to: token,
      title,
      body,
      sound: 'default' as const,
      priority: 'high' as const,
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
      mutableContent: true,
      data: {
        type: TWITTER_CAMPAIGN_PUSH_DATA_TYPE,
        campaign_id: campaignId,
        wave_id: waveId,
        assignment_id: assignmentId,
        assignmentId,
      },
    };

    try {
      const tickets = await expo.sendPushNotificationsAsync([msg]);
      const t = tickets?.[0];
      if (t?.status === 'ok') {
        const fin = await admin
          .from('notification_outbox')
          .update({
            status: 'sent',
            sent_at: nowIso(),
            attempts: attempt,
            last_error: null,
            locked_at: null,
            locked_by: null,
            lock_token: null,
          })
          .eq('id', id)
          .eq('status', 'processing')
          .eq('locked_by', WORKER.workerId)
          .eq('lock_token', lockToken)
          .select('id')
          .maybeSingle();
        if (!fin.error && fin.data) {
          const { error: evErr } = await admin.rpc('twitter_campaign_record_notification_sent', {
            p_assignment_id: assignmentId,
            p_metadata: { outbox_id: id },
          });
          if (evErr) {
            log('worker.process-twitter-campaign-notification-outbox.campaign_event', {
              id,
              assignment_id: assignmentId,
              error: evErr.message,
            });
          }
          sent++;
          results.push({ id, ok: true, sent: true });
        } else {
          skipped++;
          results.push({ id, ok: true, skipped: true, reason: 'idempotent_send_race' });
        }
        continue;
      }

      const details = (t as any)?.details as { error?: string } | undefined;
      const err = String(details?.error ?? '');
      const message = String((t as any)?.message ?? '');
      if (shouldDeleteToken(err, message)) {
        await admin.from('push_tokens').delete().eq('token', token);
      }
      const nextRetry = new Date(Date.now() + computeExponentialBackoffMsWithJitter(attempt)).toISOString();
      const terminal = attempt >= WORKER.maxAttempts;
      await admin
        .from('notification_outbox')
        .update({
          status: terminal ? 'failed' : 'pending',
          attempts: attempt,
          last_error: (message || err || 'expo_ticket_error').slice(0, 2000),
          locked_at: null,
          locked_by: null,
          lock_token: null,
          next_retry_at: terminal ? dueNowIso : nextRetry,
        })
        .eq('id', id)
        .eq('status', 'processing')
        .eq('locked_by', WORKER.workerId)
        .eq('lock_token', lockToken);
      failed++;
      results.push({ id, ok: false, error: message || err });
    } catch (e) {
      const em = e instanceof Error ? e.message : String(e);
      const nextRetry = new Date(Date.now() + computeExponentialBackoffMsWithJitter(attempt)).toISOString();
      const terminal = attempt >= WORKER.maxAttempts;
      await admin
        .from('notification_outbox')
        .update({
          status: terminal ? 'failed' : 'pending',
          attempts: attempt,
          last_error: em.slice(0, 2000),
          locked_at: null,
          locked_by: null,
          lock_token: null,
          next_retry_at: terminal ? dueNowIso : nextRetry,
        })
        .eq('id', id)
        .eq('status', 'processing')
        .eq('locked_by', WORKER.workerId)
        .eq('lock_token', lockToken);
      failed++;
      results.push({ id, ok: false, error: em });
    }
  }

  const payload = {
    ok: true,
    worker: WORKER.workerId,
    duration_ms: Date.now() - startedAt,
    metrics: {
      processed: due.length,
      sent,
      failed,
      skipped,
      cooldown_deferred: cooldownDeferred,
      cap_deferred: capDeferred,
      inactive_campaign_deferred: inactiveDeferred,
      cooldown_ms: cooldownMs,
    },
    results,
  };
  log('worker.process-twitter-campaign-notification-outbox.done', payload);
  return json(payload);
}
