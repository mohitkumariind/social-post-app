import { createServiceRoleClient } from '@/lib/admin-gate';
import { logAdminAction } from '@/lib/audit/logAdminAction';

export const runtime = 'nodejs';

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
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const got = request.headers.get('x-cron-secret')?.trim();
    if (!got || got !== secret) return json({ error: 'Unauthorized' }, 401);
  }

  const admin = createServiceRoleClient();
  if (!admin) return json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' }, 503);

  const nowIso = new Date().toISOString();

  // Fetch due scheduled events
  const r = await admin
    .from('events')
    .select('id,name,status,scheduled_at,deleted_at,created_by,published_at')
    .eq('status', 'scheduled_publish')
    .is('deleted_at', null)
    .lte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(50);

  if (r.error) {
    // If scheduled_at column isn't deployed yet, this worker should no-op safely.
    if (isMissingColumnErr(r.error, 'scheduled_at') || isMissingColumnErr(r.error, 'status')) {
      return json({ ok: true, processed: 0, skipped: true, reason: 'schema not deployed' });
    }
    return json({ error: r.error.message }, 500);
  }

  const due = (r.data ?? []) as any[];
  const results: any[] = [];

  for (const ev of due) {
    const id = String(ev?.id ?? '').trim();
    if (!id) continue;

    // Idempotency: only update rows that are still scheduled_publish and due.
    const patch = {
      status: 'published',
      published_at: nowIso,
    };

    const up = await admin
      .from('events')
      .update(patch)
      .eq('id', id)
      .eq('status', 'scheduled_publish')
      .is('deleted_at', null)
      .lte('scheduled_at', nowIso)
      .select('id,name,status,scheduled_at,created_by,published_at')
      .maybeSingle();

    if (up.error) {
      results.push({ id, ok: false, error: up.error.message });
      continue;
    }
    if (!up.data) {
      results.push({ id, ok: true, skipped: true });
      continue;
    }

    void logAdminAction({
      actor_user_id: (up.data as any)?.created_by ? String((up.data as any).created_by) : null,
      actor_role: 'system',
      action_type: 'event.published_scheduled',
      resource_type: 'events',
      resource_id: String((up.data as any)?.id ?? id),
      resource_name: (up.data as any)?.name != null ? String((up.data as any).name) : null,
      previous_data: ev,
      new_data: up.data,
      severity: 'info',
      undoable: false,
      metadata: (up.data as any)?.scheduled_at ? { scheduled_at: (up.data as any).scheduled_at } : {},
    });

    results.push({ id, ok: true });
  }

  return json({ ok: true, processed: results.length, results });
}

