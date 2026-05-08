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

  // Fetch due scheduled posts (best-effort across schemas)
  let due: any[] = [];
  {
    const r = await admin
      .from('posts')
      .select('id,title,scheduled_at,status,deleted_at,created_by')
      .eq('status', 'scheduled_publish')
      .is('deleted_at', null)
      .lte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .limit(50);

    if (r.error && (isMissingColumnErr(r.error, 'status') || isMissingColumnErr(r.error, 'deleted_at') || isMissingColumnErr(r.error, 'created_by'))) {
      // Fall back to scheduled_at-only gate if older schema
      const r2 = await admin.from('posts').select('id,title,scheduled_at').lte('scheduled_at', nowIso).order('scheduled_at', { ascending: true }).limit(50);
      if (r2.error) return json({ error: r2.error.message }, 500);
      due = (r2.data ?? []) as any[];
    } else if (r.error) {
      return json({ error: r.error.message }, 500);
    } else {
      due = (r.data ?? []) as any[];
    }
  }

  const results: any[] = [];
  for (const p of due) {
    const id = String(p?.id ?? '').trim();
    if (!id) continue;

    const patch: any = { status: 'published' };
    let up = await admin.from('posts').update(patch).eq('id', id).select('id,title,status,scheduled_at,created_by').single();
    if (up.error && isMissingColumnErr(up.error, 'status')) {
      // If status column isn't present, there is nothing to flip; treat as no-op.
      results.push({ id, ok: true, noop: true });
      continue;
    }
    if (up.error) {
      results.push({ id, ok: false, error: up.error.message });
      continue;
    }

    const row = up.data as any;
    void logAdminAction({
      actor_user_id: row?.created_by ? String(row.created_by) : null,
      actor_role: 'system',
      action_type: 'post.published_scheduled',
      resource_type: 'posts',
      resource_id: String(row?.id ?? id),
      resource_name: row?.title != null ? String(row.title) : null,
      previous_data: p,
      new_data: row,
      severity: 'info',
      undoable: false,
      metadata: row?.scheduled_at ? { scheduled_at: row.scheduled_at } : {},
    });

    results.push({ id, ok: true });
  }

  return json({ ok: true, processed: results.length, results });
}

