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

async function pruneOlderThan(admin: any, table: string, days: number) {
  const cutoffIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const res = await admin.from(table).delete().lt('created_at', cutoffIso).select('id', { count: 'exact', head: true });
  if ((res as any).error) {
    const msg = String((res as any).error?.message ?? '');
    const missing = msg.toLowerCase().includes('does not exist') || msg.toLowerCase().includes('schema cache');
    if (missing) return { table, pruned: 0, skipped: true, reason: 'table-missing' as const };
    throw new Error(`${table}: ${(res as any).error.message}`);
  }
  return { table, pruned: Number((res as any).count ?? 0), skipped: false };
}

export async function POST(request: Request) {
  const cronAuth = validateCronRequest(request);
  if (!cronAuth.ok) return json({ error: cronAuth.error }, cronAuth.status);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const adminLogDays = retentionDays('RETENTION_ADMIN_LOG_DAYS', 180);
  const rbacObsDays = retentionDays('RETENTION_RBAC_OBS_DAYS', 30);
  const notifHistoryDays = retentionDays('RETENTION_NOTIFICATION_HISTORY_DAYS', 120);

  try {
    const [adminLogs, rbacObs, notifHistory] = await Promise.all([
      pruneOlderThan(admin, 'admin_logs', adminLogDays),
      pruneOlderThan(admin, 'rbac_observability_events', rbacObsDays),
      pruneOlderThan(admin, 'notifications_history', notifHistoryDays),
    ]);
    return json({
      ok: true,
      retention_days: {
        admin_logs: adminLogDays,
        rbac_observability_events: rbacObsDays,
        notifications_history: notifHistoryDays,
      },
      results: [adminLogs, rbacObs, notifHistory],
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'cleanup failed' }, 500);
  }
}
