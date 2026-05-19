import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { fetchCampaignIntelligencePage, parseAnalyticsPagination } from '@/lib/admin/analyticsApi';
import { adminAnalyticsScopeCacheKey } from '@/lib/admin/rbac';
import { requireAdminAnalyticsContext } from '../_lib';

/** Server-side cache TTL for aggregated metrics (seconds). */
const CI_METRICS_REVALIDATE_SEC = 45;

/**
 * GET /api/admin/analytics/campaign-intelligence
 *
 * Query: search, offset, limit. Fixed last-7-day event metrics (posts, raw downloads, engaged users).
 */
export async function GET(request: NextRequest) {
  const ctx = await requireAdminAnalyticsContext();
  if (!ctx.ok) return ctx.response;

  const sp = request.nextUrl.searchParams;
  const { offset, limit } = parseAnalyticsPagination(sp);
  const searchRaw = sp.get('search');
  const searchNorm = searchRaw != null && String(searchRaw).trim() !== '' ? String(searchRaw).trim() : null;
  const bypassCache = sp.get('fresh') === '1';

  const opts = { search: searchNorm, offset, limit };

  const cacheKey = [
    'event-metrics-7d',
    'v1',
    adminAnalyticsScopeCacheKey(ctx.scope),
    searchNorm ?? '',
    String(offset),
    String(limit),
  ];

  const runFetch = () => fetchCampaignIntelligencePage(ctx.admin, ctx.scope, opts);

  let result: Awaited<ReturnType<typeof fetchCampaignIntelligencePage>>;
  try {
    result = bypassCache
      ? await runFetch()
      : await unstable_cache(
          async () => {
            const r = await runFetch();
            if (!r.ok) throw new Error(r.error);
            return r;
          },
          cacheKey,
          { revalidate: CI_METRICS_REVALIDATE_SEC }
        )();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load event metrics';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result.data, {
    headers: {
      'Cache-Control': `private, max-age=${CI_METRICS_REVALIDATE_SEC}, stale-while-revalidate=60`,
      Vary: 'Cookie',
    },
  });
}
