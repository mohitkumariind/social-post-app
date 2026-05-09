import { createServiceRoleClient } from '@/lib/admin-gate';
import { validateCronRequest } from '@/lib/cron-auth';

export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function retentionDays(name: string, fallback: number, min = 1, max = 3650) {
  const raw = process.env[name];
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function isMissingSchemaError(err: { message?: string } | null | undefined, token: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(token.toLowerCase()) && (msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('column'));
}

const CLEANUP_BATCH_SIZE = 500;
const CLEANUP_MAX_BATCHES = 200;

async function pruneScheduledNotifications(admin: any, cutoffIso: string) {
  let pruned = 0;
  let batches = 0;
  let truncated = false;
  for (;;) {
    if (batches >= CLEANUP_MAX_BATCHES) {
      truncated = true;
      break;
    }
    const sel = await admin
      .from('scheduled_notifications')
      .select('id')
      .in('status', ['sent', 'cancelled'])
      .lt('created_at', cutoffIso)
      .order('created_at', { ascending: true })
      .limit(CLEANUP_BATCH_SIZE);
    if ((sel as any).error) throw new Error((sel as any).error.message);
    const rows = Array.isArray((sel as any).data) ? ((sel as any).data as { id: string }[]) : [];
    if (rows.length === 0) break;
    const ids = rows.map((r) => String(r.id)).filter(Boolean);
    const del = await admin.from('scheduled_notifications').delete().in('id', ids);
    if ((del as any).error) throw new Error((del as any).error.message);
    pruned += ids.length;
    batches++;
    if (rows.length < CLEANUP_BATCH_SIZE) break;
  }
  return { pruned, batches, batch_size: CLEANUP_BATCH_SIZE, truncated };
}

async function clearNonProcessingLocks(admin: any, table: string, processingStatus: string, olderThanIso?: string) {
  let cleared = 0;
  let batches = 0;
  let truncated = false;
  for (;;) {
    if (batches >= CLEANUP_MAX_BATCHES) {
      truncated = true;
      break;
    }
    let q = admin
      .from(table)
      .select('id')
      .neq('status', processingStatus)
      .not('locked_at', 'is', null)
      .order('locked_at', { ascending: true })
      .limit(CLEANUP_BATCH_SIZE);
    if (olderThanIso) q = q.lt('created_at', olderThanIso);
    const sel = await q;
    if ((sel as any).error) {
      if (isMissingSchemaError((sel as any).error, 'locked_at')) {
        return { cleared: 0, batches: 0, batch_size: CLEANUP_BATCH_SIZE, truncated: false, skipped: true, reason: 'locked-columns-missing' as const };
      }
      throw new Error((sel as any).error.message);
    }
    const rows = Array.isArray((sel as any).data) ? ((sel as any).data as { id: string }[]) : [];
    if (rows.length === 0) break;
    const ids = rows.map((r) => String(r.id)).filter(Boolean);
    const upd = await admin.from(table).update({ locked_at: null, locked_by: null }).in('id', ids);
    if ((upd as any).error) {
      if (isMissingSchemaError((upd as any).error, 'locked_at')) {
        return { cleared: 0, batches: 0, batch_size: CLEANUP_BATCH_SIZE, truncated: false, skipped: true, reason: 'locked-columns-missing' as const };
      }
      throw new Error((upd as any).error.message);
    }
    cleared += ids.length;
    batches++;
    if (rows.length < CLEANUP_BATCH_SIZE) break;
  }
  return { cleared, batches, batch_size: CLEANUP_BATCH_SIZE, truncated, skipped: false };
}

export async function POST(request: Request) {
  const cronAuth = validateCronRequest(request);
  if (!cronAuth.ok) return json({ error: cronAuth.error }, cronAuth.status);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const startedAt = Date.now();
  const schedNotifDays = retentionDays('RETENTION_SCHEDULED_NOTIFICATIONS_DAYS', 45);
  const failedPublishDays = retentionDays('RETENTION_FAILED_PUBLISH_DAYS', 30);
  const notifCutoff = new Date(Date.now() - schedNotifDays * 24 * 60 * 60 * 1000).toISOString();
  const publishCutoff = new Date(Date.now() - failedPublishDays * 24 * 60 * 60 * 1000).toISOString();
  const worker = process.env.WORKER_ID?.trim() || 'api/jobs/cleanup-scheduler-state';

  console.info('[worker.cleanup-scheduler-state.start]', JSON.stringify({
    worker,
    retention_days: {
      scheduled_notifications_terminal: schedNotifDays,
      scheduled_publish_failed: failedPublishDays,
    },
  }));

  try {
    const notifDelete = await pruneScheduledNotifications(admin, notifCutoff);
    const staleLocks = await clearNonProcessingLocks(admin, 'scheduled_notifications', 'processing');
    const postsLocks = await clearNonProcessingLocks(admin, 'posts', 'processing_publish', publishCutoff);
    const eventsLocks = await clearNonProcessingLocks(admin, 'events', 'processing_publish', publishCutoff);

    const payload = {
      ok: true,
      worker,
      duration_ms: Date.now() - startedAt,
      retention_days: {
        scheduled_notifications_terminal: schedNotifDays,
        scheduled_publish_failed: failedPublishDays,
      },
      results: {
        scheduled_notifications_pruned: notifDelete.pruned,
        scheduled_notifications_prune_batches: notifDelete.batches,
        scheduled_notifications_prune_truncated: notifDelete.truncated,
        scheduled_notifications_stale_locks_cleared: staleLocks.cleared,
        scheduled_notifications_lock_cleanup_batches: staleLocks.batches,
        posts_stale_locks_cleared: postsLocks.cleared,
        posts_lock_cleanup_batches: postsLocks.batches,
        posts_lock_cleanup_skipped: postsLocks.skipped,
        events_stale_locks_cleared: eventsLocks.cleared,
        events_lock_cleanup_batches: eventsLocks.batches,
        events_lock_cleanup_skipped: eventsLocks.skipped,
      },
    };
    console.info('[worker.cleanup-scheduler-state.done]', JSON.stringify(payload));
    return json(payload);
  } catch (e) {
    const err = e instanceof Error ? e.message : 'cleanup failed';
    console.error('[worker.cleanup-scheduler-state.failed]', JSON.stringify({
      worker,
      duration_ms: Date.now() - startedAt,
      error: err,
    }));
    return json({ error: err }, 500);
  }
}
