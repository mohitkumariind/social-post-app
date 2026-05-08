import { createServiceRoleClient } from '@/lib/admin-gate';

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

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const got = request.headers.get('x-cron-secret')?.trim();
    if (!got || got !== secret) return json({ error: 'Unauthorized' }, 401);
  }

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

    // Notifications: use notification_broadcasts table as source of truth.
    const { data: nbRows, error: nbErr } = await admin
      .from('notification_broadcasts')
      .select('sent_count,delivered_count,opened_count')
      .gte('created_at', startIso)
      .lte('created_at', endIso);
    if (nbErr) return json({ error: nbErr.message }, 500);
    const sent = (nbRows ?? []).reduce((a: number, r: any) => a + Number(r.sent_count ?? 0), 0);
    const delivered = (nbRows ?? []).reduce((a: number, r: any) => a + Number(r.delivered_count ?? 0), 0);
    const opened = (nbRows ?? []).reduce((a: number, r: any) => a + Number(r.opened_count ?? 0), 0);

    // Events lifecycle: use admin_logs transitions as the source (no heavy live aggregation).
    const { data: evLogs, error: evErr } = await admin
      .from('admin_logs')
      .select('action_type')
      .eq('resource_type', 'events')
      .in('action_type', ['events.publish', 'events.archive', 'events.unpublish', 'events.delete'])
      .gte('created_at', startIso)
      .lte('created_at', endIso);
    if (evErr) return json({ error: evErr.message }, 500);
    const publishedCount = (evLogs ?? []).filter((r: any) => String(r.action_type) === 'events.publish').length;

    // Active published count: computed from events table with lightweight filtered query for the day snapshot.
    // (Still not a dashboard live query — this is run in worker.)
    const { data: activeRows, error: actErr } = await admin
      .from('events')
      .select('id')
      .is('deleted_at', null)
      .in('status', ['published', 'scheduled_publish'])
      .lte('start', endIso)
      .gte('end', startIso);
    if (actErr) return json({ error: actErr.message }, 500);
    const activePublishedCount = (activeRows ?? []).length;

    const nRow = { day: dayKey, sent_count: sent, delivered_count: delivered, opened_count: opened };
    const eRow = { day: dayKey, active_published_count: activePublishedCount, published_count: publishedCount };

    const { error: upN } = await admin.from('analytics_daily_notifications').upsert(nRow as any);
    if (upN) return json({ error: upN.message }, 500);
    const { error: upE } = await admin.from('analytics_daily_events').upsert(eRow as any);
    if (upE) return json({ error: upE.message }, 500);

    out.push({ day: dayKey, notifications: nRow, events: eRow });
  }

  return json({ ok: true, days, rolled_up: out.length, rows: out });
}

