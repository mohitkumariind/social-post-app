import { NextResponse } from 'next/server';
import { validateAdminSession } from '@/lib/admin-gate';
import { runTwitterCampaignWorkerPipeline } from '@/lib/twitter-campaign-invoke-workers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RbacError, requireRole } from '@/lib/rbac/require';

const CANONICAL_PATH = '/api/admin/twitter-campaigns/workers';
const LEGACY_PATH = '/api/admin/twitter-campaign-workers';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function twitterCampaignWorkersGET() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return json(
      {
        error: auth.status === 401 ? 'Unauthorized' : 'Forbidden',
        methods: ['POST'],
        hint: 'Sign in to the admin panel, then POST to this URL.',
      },
      auth.status
    );
  }

  try {
    requireRole(auth, ['admin']);
  } catch (e) {
    if (e instanceof RbacError) return json({ error: e.message, methods: ['POST'] }, e.status);
    return json({ error: 'Forbidden', methods: ['POST'] }, 403);
  }

  return json({
    ok: true,
    endpoint: CANONICAL_PATH,
    legacy_endpoint: LEGACY_PATH,
    methods: ['POST'],
    cron_secret_configured: Boolean(process.env.CRON_SECRET?.trim()),
    hint: 'POST with optional JSON body: { "maxWaveRuns": 4, "maxOutboxRuns": 6 }',
  });
}

export async function twitterCampaignWorkersPOST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) return json({ error: 'Unauthorized' }, auth.status);

  try {
    requireRole(auth, ['admin']);
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
    JSON.stringify({ user_id: auth.user.id, role: auth.role, maxWaveRuns, maxOutboxRuns, path: CANONICAL_PATH })
  );

  try {
    const pipeline = await runTwitterCampaignWorkerPipeline({ maxWaveRuns, maxOutboxRuns });
    return json({ trigger: 'admin', ...pipeline });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'unknown');
    return json({ ok: false, error: msg }, 500);
  }
}
