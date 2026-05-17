import { POST as processTwitterCampaignWaves } from '@/app/api/jobs/process-twitter-campaign-waves/route';
import { POST as processTwitterCampaignNotificationOutbox } from '@/app/api/jobs/process-twitter-campaign-notification-outbox/route';

export type TwitterWorkerRunResult = {
  ok: boolean;
  status: number;
  duration_ms: number;
  body: Record<string, unknown>;
};

function buildCronWorkerRequest(path: string): Request {
  const secret = process.env.CRON_SECRET?.trim() ?? '';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret) {
    headers['x-cron-secret'] = secret;
    headers.authorization = `Bearer ${secret}`;
  }
  return new Request(`https://workers.internal${path}`, { method: 'POST', headers });
}

async function runWorker(
  handler: (request: Request) => Promise<Response>,
  path: string
): Promise<TwitterWorkerRunResult> {
  const started = Date.now();
  const res = await handler(buildCronWorkerRequest(path));
  let body: Record<string, unknown> = {};
  try {
    const parsed = await res.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    body = { parse_error: true };
  }
  return { ok: res.ok, status: res.status, duration_ms: Date.now() - started, body };
}

function waveRunShouldContinue(run: TwitterWorkerRunResult): boolean {
  if (!run.ok) return false;
  const metrics = (run.body.metrics ?? {}) as Record<string, unknown>;
  const candidates = Number(metrics.candidates ?? 0);
  const results = Array.isArray(run.body.results) ? (run.body.results as Record<string, unknown>[]) : [];
  const hasPaused = results.some((r) => r.paused === true);
  const hasClaimed = results.some((r) => r.ok === true && !r.skipped);
  return candidates > 0 || hasPaused || hasClaimed;
}

function outboxRunShouldContinue(run: TwitterWorkerRunResult): boolean {
  if (!run.ok) return false;
  const metrics = (run.body.metrics ?? {}) as Record<string, unknown>;
  const processed = Number(metrics.processed ?? 0);
  const sent = Number(metrics.sent ?? 0);
  const failed = Number(metrics.failed ?? 0);
  const deferred =
    Number(metrics.cooldown_deferred ?? 0) +
    Number(metrics.cap_deferred ?? 0) +
    Number(metrics.inactive_campaign_deferred ?? 0);
  return processed > 0 || sent > 0 || failed > 0 || deferred > 0;
}

export type TwitterCampaignPipelineResult = {
  ok: boolean;
  started_at: string;
  duration_ms: number;
  wave_runs: TwitterWorkerRunResult[];
  outbox_runs: TwitterWorkerRunResult[];
  summary: {
    wave_runs: number;
    outbox_runs: number;
    wave_errors: number;
    outbox_errors: number;
    assignments_inserted: number;
    notifications_sent: number;
    notifications_failed: number;
  };
};

/**
 * Runs wave staging then notification delivery (same handlers as cron job routes).
 * Safe to call from Vercel cron (GET) or admin debug POST.
 */
export async function runTwitterCampaignWorkerPipeline(opts?: {
  maxWaveRuns?: number;
  maxOutboxRuns?: number;
}): Promise<TwitterCampaignPipelineResult> {
  const maxWaveRuns = Math.max(1, Math.min(opts?.maxWaveRuns ?? 4, 12));
  const maxOutboxRuns = Math.max(1, Math.min(opts?.maxOutboxRuns ?? 6, 20));
  const startedAt = Date.now();
  const waveRuns: TwitterWorkerRunResult[] = [];
  const outboxRuns: TwitterWorkerRunResult[] = [];

  console.info(
    '[twitter-campaign.pipeline.start]',
    JSON.stringify({ max_wave_runs: maxWaveRuns, max_outbox_runs: maxOutboxRuns })
  );

  for (let i = 0; i < maxWaveRuns; i++) {
    const run = await runWorker(processTwitterCampaignWaves, '/api/jobs/process-twitter-campaign-waves');
    waveRuns.push(run);
    console.info(
      '[twitter-campaign.pipeline.wave_run]',
      JSON.stringify({
        index: i + 1,
        ok: run.ok,
        status: run.status,
        duration_ms: run.duration_ms,
        metrics: run.body.metrics ?? null,
      })
    );
    if (!waveRunShouldContinue(run)) break;
  }

  for (let i = 0; i < maxOutboxRuns; i++) {
    const run = await runWorker(
      processTwitterCampaignNotificationOutbox,
      '/api/jobs/process-twitter-campaign-notification-outbox'
    );
    outboxRuns.push(run);
    console.info(
      '[twitter-campaign.pipeline.outbox_run]',
      JSON.stringify({
        index: i + 1,
        ok: run.ok,
        status: run.status,
        duration_ms: run.duration_ms,
        metrics: run.body.metrics ?? null,
      })
    );
    if (!outboxRunShouldContinue(run)) break;
  }

  let assignmentsInserted = 0;
  let notificationsSent = 0;
  let notificationsFailed = 0;
  for (const run of waveRuns) {
    const m = (run.body.metrics ?? {}) as Record<string, unknown>;
    assignmentsInserted += Number(m.assignments_inserted ?? 0);
  }
  for (const run of outboxRuns) {
    const m = (run.body.metrics ?? {}) as Record<string, unknown>;
    notificationsSent += Number(m.sent ?? 0);
    notificationsFailed += Number(m.failed ?? 0);
  }

  const result: TwitterCampaignPipelineResult = {
    ok: waveRuns.every((r) => r.ok) && outboxRuns.every((r) => r.ok),
    started_at: new Date(startedAt).toISOString(),
    duration_ms: Date.now() - startedAt,
    wave_runs: waveRuns,
    outbox_runs: outboxRuns,
    summary: {
      wave_runs: waveRuns.length,
      outbox_runs: outboxRuns.length,
      wave_errors: waveRuns.filter((r) => !r.ok).length,
      outbox_errors: outboxRuns.filter((r) => !r.ok).length,
      assignments_inserted: assignmentsInserted,
      notifications_sent: notificationsSent,
      notifications_failed: notificationsFailed,
    },
  };

  console.info('[twitter-campaign.pipeline.done]', JSON.stringify(result.summary));
  return result;
}
