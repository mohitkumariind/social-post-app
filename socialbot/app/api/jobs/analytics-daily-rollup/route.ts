import { createServiceRoleClient } from '@/lib/admin-gate';
import { validateCronRequest } from '@/lib/cron-auth';

export const runtime = 'nodejs';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function yyyyMmDd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Aggregate notification counters in bounded pages so the worker does not
 * materialize an unbounded day slice into memory.
 */
async function sumNotificationBroadcastCounters(
  admin: any,
  startIso: string,
  endIso: string
): Promise<{ sent: number; delivered: number; opened: number }> {
  const pageSize = 1000;
  let from = 0;
  let sent = 0;
  let delivered = 0;
  let opened = 0;

  for (;;) {
    const { data, error } = await admin
      .from('notification_broadcasts')
      .select('sent_count,delivered_count,opened_count')
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) break;
    for (const r of rows) {
      sent += Number(r.sent_count ?? 0);
      delivered += Number(r.delivered_count ?? 0);
      opened += Number(r.opened_count ?? 0);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 5_000_000) break;
  }

  return { sent, delivered, opened };
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const cronAuth = validateCronRequest(request);
  if (!cronAuth.ok) return json({ error: cronAuth.error }, cronAuth.status);

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const daysRaw = Number(new URL(request.url).searchParams.get('days') ?? 7);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(31, Math.floor(daysRaw))) : 7;

  const out: any[] = [];
  for (let i = 0; i < days; i++) {
    const dayStart = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);

    const startIso = dayStart.toISOString();
    const endIso = dayEnd.toISOString();
    const dayKey = yyyyMmDd(dayStart);

    try {
      // Notifications: source of truth with bounded memory scan.
      const { sent, delivered, opened } = await sumNotificationBroadcastCounters(admin, startIso, endIso);

      // Events lifecycle: use admin_logs transition count directly (no full row materialization).
      const { count: publishedCount, error: evErr } = await admin
        .from('admin_logs')
        .select('id', { count: 'exact', head: true })
        .eq('resource_type', 'events')
        .eq('action_type', 'events.publish')
        .gte('created_at', startIso)
        .lte('created_at', endIso);
      if (evErr) return json({ error: evErr.message }, 500);

      // Active published count: overlap query as count-only.
      const { count: activePublishedCount, error: actErr } = await admin
        .from('events')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .in('status', ['published', 'scheduled_publish'])
        .lte('start', endIso)
        .gte('end', startIso);
      if (actErr) return json({ error: actErr.message }, 500);

      const nRow = { day: dayKey, sent_count: sent, delivered_count: delivered, opened_count: opened };
      const eRow = {
        day: dayKey,
        active_published_count: typeof activePublishedCount === 'number' ? activePublishedCount : 0,
        published_count: typeof publishedCount === 'number' ? publishedCount : 0,
      };

      const { error: upN } = await admin.from('analytics_daily_notifications').upsert(nRow as any);
      if (upN) return json({ error: upN.message }, 500);
      const { error: upE } = await admin.from('analytics_daily_events').upsert(eRow as any);
      if (upE) return json({ error: upE.message }, 500);

      out.push({ day: dayKey, notifications: nRow, events: eRow });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: msg }, 500);
    }
  }

  return json({
    ok: true,
    worker: 'api/jobs/analytics-daily-rollup',
    duration_ms: Date.now() - startedAt,
    days,
    rolled_up: out.length,
    rows: out,
  });
}

