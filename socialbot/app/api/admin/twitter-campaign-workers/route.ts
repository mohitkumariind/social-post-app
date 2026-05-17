import { NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-gate';
import { runTwitterCampaignWorkerPipeline } from '@/lib/twitter-campaign-invoke-workers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RbacError, requireRole } from '@/lib/rbac/require';

export const runtime = 'nodejs';
export const maxDuration = 300;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Admin-only manual trigger for Twitter campaign workers (debug / recovery).
 * Path is outside `/twitter-campaigns/[id]` so it is never captured as a campaign UUID.
 *
 * POST body (optional): { "maxWaveRuns": 4, "maxOutboxRuns": 6 }
 */
export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: 'Unauthorized' }, auth.status);

  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message }, e.status);
    return json({ error: 'Forbidden' }, 403);
  }

  if (!process.env.CRON_SECRET?.trim()) {
    return json({ error: 'CRON_SECRET not configured on server (required to invoke workers)' }, 503);
  }

  let maxWaveRuns: number | undefined;
  let maxOutboxRuns: number | undefined;
  try {
    const body = await req.json();
    if (body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      if (typeof b.maxWaveRuns === 'number' && Number.isFinite(b.maxWaveRuns)) {
        maxWaveRuns = b.maxWaveRuns;
      }
      if (typeof b.maxOutboxRuns === 'number' && Number.isFinite(b.maxOutboxRuns)) {
        maxOutboxRuns = b.maxOutboxRuns;
      }
    }
  } catch {
    // empty body is fine
  }

  console.info(
    '[admin.twitter-campaign-workers]',
    JSON.stringify({ user_id: auth.user.id, role: auth.role, maxWaveRuns, maxOutboxRuns })
  );

  try {
    const pipeline = await runTwitterCampaignWorkerPipeline({ maxWaveRuns, maxOutboxRuns });
    return json({ trigger: 'admin', ...pipeline });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'unknown');
    return json({ ok: false, error: msg }, 500);
  }
}
