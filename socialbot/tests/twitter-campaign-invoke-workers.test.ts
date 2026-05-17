import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/app/api/jobs/process-twitter-campaign-waves/route', () => ({
  POST: vi.fn(async () =>
    new Response(
      JSON.stringify({
        ok: true,
        metrics: { candidates: 1, assignments_inserted: 2 },
        results: [{ ok: true, completed: true }],
      }),
      { status: 200 }
    )
  ),
}));

vi.mock('@/app/api/jobs/process-twitter-campaign-notification-outbox/route', () => ({
  POST: vi.fn(async () =>
    new Response(
      JSON.stringify({
        ok: true,
        metrics: { processed: 0, sent: 0 },
      }),
      { status: 200 }
    )
  ),
}));

describe('runTwitterCampaignWorkerPipeline', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
  });

  it('runs wave worker then outbox worker', async () => {
    const { runTwitterCampaignWorkerPipeline } = await import('@/lib/twitter-campaign-invoke-workers');
    const result = await runTwitterCampaignWorkerPipeline({ maxWaveRuns: 2, maxOutboxRuns: 2 });
    expect(result.wave_runs.length).toBeGreaterThanOrEqual(1);
    expect(result.outbox_runs.length).toBeGreaterThanOrEqual(1);
    expect(result.summary.assignments_inserted).toBeGreaterThanOrEqual(2);
  });
});
