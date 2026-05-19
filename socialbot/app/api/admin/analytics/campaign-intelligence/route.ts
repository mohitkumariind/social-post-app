import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import {
  assertAnalyticsGeoFiltersAllowed,
  fetchCampaignIntelligencePage,
  parseAnalyticsGeoFilters,
  parseAnalyticsPagination,
} from '@/lib/admin/analyticsApi';
import { adminAnalyticsScopeCacheKey } from '@/lib/admin/rbac';
import { requireAdminAnalyticsContext } from '../_lib';

const CI_METRICS_REVALIDATE_SEC = 45;

/**
 * GET /api/admin/analytics/campaign-intelligence
 * Fixed last-7-day event metrics; optional state_id + party filters.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireAdminAnalyticsContext();
  if (!ctx.ok) return ctx.response;

  const sp = request.nextUrl.searchParams;
  const filters = parseAnalyticsGeoFilters(sp);
  const allowed = assertAnalyticsGeoFiltersAllowed(ctx.auth, filters);
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.message }, { status: allowed.status });
  }

  const { offset, limit } = parseAnalyticsPagination(sp);
  const bypassCache = sp.get('fresh') === '1';

  const opts = { filters, offset, limit };

  const cacheKey = [
    'event-metrics-7d',
    'v3',
    adminAnalyticsScopeCacheKey(ctx.scope),
    String(filters.stateId ?? ''),
    filters.party ?? '',
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
