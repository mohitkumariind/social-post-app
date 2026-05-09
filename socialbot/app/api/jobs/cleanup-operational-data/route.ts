import { createServiceRoleClient } from '@/lib/admin-gate';
import { validateCronRequest } from '@/lib/cron-auth';

export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function retentionDays(envName: string, fallback: number) {
  const raw = process.env[envName];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(3650, Math.trunc(n));
}

const CLEANUP_BATCH_SIZE = 1000;
const CLEANUP_MAX_BATCHES = 200;

async function pruneOlderThan(admin: any, table: string, days: number) {
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let pruned = 0;
  let batches = 0;
  let truncated = false;
  for (;;) {
    if (batches >= CLEANUP_MAX_BATCHES) {
      truncated = true;
      break;
    }
    const sel = await admin.from(table).select('id').lt('created_at', cutoffIso).order('created_at', { ascending: true }).limit(CLEANUP_BATCH_SIZE);
    if ((sel as any).error) {
      const msg = String((sel as any).error?.message ?? '');
      const missing = msg.toLowerCase().includes('does not exist') || msg.toLowerCase().includes('schema cache');
      if (missing) return { table, pruned: 0, skipped: true, reason: 'table-missing' as const };
      throw new Error(`${table}: ${(sel as any).error.message}`);
    }
    const rows = Array.isArray((sel as any).data) ? ((sel as any).data as { id: string }[]) : [];
    if (rows.length === 0) break;
    const ids = rows.map((r) => String(r.id)).filter(Boolean);
    const del = await admin.from(table).delete().in('id', ids);
    if ((del as any).error) {
      const msg = String((del as any).error?.message ?? '');
      const missing = msg.toLowerCase().includes('does not exist') || msg.toLowerCase().includes('schema cache');
      if (missing) return { table, pruned: 0, skipped: true, reason: 'table-missing' as const };
      throw new Error(`${table}: ${(del as any).error.message}`);
    }
    pruned += ids.length;
    batches++;
    if (rows.length < CLEANUP_BATCH_SIZE) break;
  }
  return { table, pruned, batches, batch_size: CLEANUP_BATCH_SIZE, truncated, skipped: false };
}

function workerId() {
  return process.env.WORKER_ID?.trim() || 'api/jobs/cleanup-operational-data';
}

export async function POST(request: Request) {
  const cronAuth = validateCronRequest(request);
  if (!cronAuth.ok) return json({ error: cronAuth.error }, cronAuth.status);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const adminLogDays = retentionDays('RETENTION_ADMIN_LOG_DAYS', 180);
  const rbacObsDays = retentionDays('RETENTION_RBAC_OBS_DAYS', 30);
  const notifHistoryDays = retentionDays('RETENTION_NOTIFICATION_HISTORY_DAYS', 120);
  const startedAt = Date.now();
  const wid = workerId();

  console.info('[worker.cleanup-operational-data.start]', JSON.stringify({
    worker: wid,
    retention_days: {
      admin_logs: adminLogDays,
      rbac_observability_events: rbacObsDays,
      notifications_history: notifHistoryDays,
    },
  }));

  try {
    const [adminLogs, rbacObs, notifHistory] = await Promise.all([
      pruneOlderThan(admin, 'admin_logs', adminLogDays),
      pruneOlderThan(admin, 'rbac_observability_events', rbacObsDays),
      pruneOlderThan(admin, 'notifications_history', notifHistoryDays),
    ]);
    const response = {
      ok: true,
      worker: wid,
      duration_ms: Date.now() - startedAt,
      retention_days: {
        admin_logs: adminLogDays,
        rbac_observability_events: rbacObsDays,
        notifications_history: notifHistoryDays,
      },
      results: [adminLogs, rbacObs, notifHistory],
    };
    console.info('[worker.cleanup-operational-data.done]', JSON.stringify(response));
    return json(response);
  } catch (e) {
    const errorPayload = {
      worker: wid,
      duration_ms: Date.now() - startedAt,
      error: e instanceof Error ? e.message : 'cleanup failed',
    };
    console.error('[worker.cleanup-operational-data.failed]', JSON.stringify(errorPayload));
    return json({ error: errorPayload.error }, 500);
  }
}
