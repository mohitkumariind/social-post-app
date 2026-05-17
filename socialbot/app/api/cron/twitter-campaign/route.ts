import { validateCronRequest } from '@/lib/cron-auth';
import { runTwitterCampaignWorkerPipeline } from '@/lib/twitter-campaign-invoke-workers';

export const runtime = 'nodejs';
export const maxDuration = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Vercel Cron entry (GET). Chains wave worker + notification outbox worker.
 * Auth: CRON_SECRET via Authorization: Bearer (Vercel) or x-cron-secret.
 */
export async function GET(request: Request) {
  const cronAuth = validateCronRequest(request);
  if (!cronAuth.ok) {
    console.warn('[cron.twitter-campaign.auth_failed]', JSON.stringify({ error: cronAuth.error }));
    return json({ ok: false, error: cronAuth.error }, cronAuth.status);
  }

  if (!process.env.CRON_SECRET?.trim()) {
    return json({ ok: false, error: 'CRON_SECRET not configured' }, 503);
  }

  try {
    const pipeline = await runTwitterCampaignWorkerPipeline();
    return json({ trigger: 'cron', ...pipeline });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e ?? 'unknown');
    console.error('[cron.twitter-campaign.error]', JSON.stringify({ error: msg }));
    return json({ ok: false, error: msg }, 500);
  }
}

/** Manual/curl POST trigger (same pipeline as GET). */
export async function POST(request: Request) {
  return GET(request);
}
