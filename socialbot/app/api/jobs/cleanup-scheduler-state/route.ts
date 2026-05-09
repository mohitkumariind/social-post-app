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

  // 1) Remove terminal scheduled_notifications rows older than retention.
  const notifDelete = await admin
    .from('scheduled_notifications')
    .delete()
    .in('status', ['sent', 'cancelled'])
    .lt('created_at', notifCutoff)
    .select('id');
  if ((notifDelete as any).error) return json({ error: (notifDelete as any).error.message }, 500);

  // 2) Defensive lock cleanup for non-processing rows where stale lock metadata remains.
  const staleLocks = await admin
    .from('scheduled_notifications')
    .update({ locked_at: null, locked_by: null })
    .neq('status', 'processing')
    .not('locked_at', 'is', null)
    .select('id');
  if ((staleLocks as any).error) return json({ error: (staleLocks as any).error.message }, 500);

  let postsStaleLocksCount = 0;
  const postsStaleLocks = await admin
    .from('posts')
    .update({ locked_at: null, locked_by: null })
    .neq('status', 'processing_publish')
    .not('locked_at', 'is', null)
    .lt('created_at', publishCutoff)
    .select('id');
  if ((postsStaleLocks as any).error) {
    if (!isMissingSchemaError((postsStaleLocks as any).error, 'locked_at')) {
      return json({ error: (postsStaleLocks as any).error.message }, 500);
    }
  } else {
    postsStaleLocksCount = Array.isArray((postsStaleLocks as any).data) ? (postsStaleLocks as any).data.length : 0;
  }

  let eventsStaleLocksCount = 0;
  const eventsStaleLocks = await admin
    .from('events')
    .update({ locked_at: null, locked_by: null })
    .neq('status', 'processing_publish')
    .not('locked_at', 'is', null)
    .lt('created_at', publishCutoff)
    .select('id');
  if ((eventsStaleLocks as any).error) {
    if (!isMissingSchemaError((eventsStaleLocks as any).error, 'locked_at')) {
      return json({ error: (eventsStaleLocks as any).error.message }, 500);
    }
  } else {
    eventsStaleLocksCount = Array.isArray((eventsStaleLocks as any).data) ? (eventsStaleLocks as any).data.length : 0;
  }

  return json({
    ok: true,
    worker: 'api/jobs/cleanup-scheduler-state',
    duration_ms: Date.now() - startedAt,
    retention_days: {
      scheduled_notifications_terminal: schedNotifDays,
      scheduled_publish_failed: failedPublishDays,
    },
    results: {
      scheduled_notifications_pruned: Array.isArray((notifDelete as any).data) ? (notifDelete as any).data.length : 0,
      scheduled_notifications_stale_locks_cleared: Array.isArray((staleLocks as any).data) ? (staleLocks as any).data.length : 0,
      posts_stale_locks_cleared: postsStaleLocksCount,
      events_stale_locks_cleared: eventsStaleLocksCount,
    },
  });
}
