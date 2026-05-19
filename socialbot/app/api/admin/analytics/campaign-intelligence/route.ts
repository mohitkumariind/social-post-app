import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import {
  fetchCampaignIntelligencePage,
  parseAnalyticsDateRange,
  parseAnalyticsPagination,
} from '@/lib/admin/analyticsApi';
import { adminAnalyticsScopeCacheKey } from '@/lib/admin/rbac';
import { requireAdminAnalyticsContext } from '../_lib';

/** Server-side cache TTL for aggregated metrics (seconds). */
const CI_METRICS_REVALIDATE_SEC = 45;

/**
 * GET /api/admin/analytics/campaign-intelligence
 *
 * Query: date_from, date_to (required), search, offset, limit. Raw downloads + engaged users per event.
 * RBAC scope is resolved in {@link requireAdminAnalyticsContext} before any metrics work.
 * Optional `fresh=1` bypasses the short-lived server cache (debugging).
 */
export async function GET(request: NextRequest) {
  const ctx = await requireAdminAnalyticsContext();
  if (!ctx.ok) return ctx.response;

  const sp = request.nextUrl.searchParams;
  const { dateFrom, dateTo } = parseAnalyticsDateRange(sp);
  if ((dateFrom == null) !== (dateTo == null)) {
    return NextResponse.json({ error: 'Provide both date_from and date_to, or neither' }, { status: 400 });
  }
  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
    return NextResponse.json({ error: 'date_from must be before or equal to date_to' }, { status: 400 });
  }

  const { offset, limit } = parseAnalyticsPagination(sp);
  const searchRaw = sp.get('search');
  const searchNorm = searchRaw != null && String(searchRaw).trim() !== '' ? String(searchRaw).trim() : null;
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'date_from and date_to are required' }, { status: 400 });
  }

  const bypassCache = sp.get('fresh') === '1';

  const opts = {
    dateFrom,
    dateTo,
    search: searchNorm,
    offset,
    limit,
  };

  const cacheKey = [
    'raw-download-events',
    'v2',
    adminAnalyticsScopeCacheKey(ctx.scope),
    dateFrom.toISOString(),
    dateTo.toISOString(),
    searchNorm ?? '',
    String(offset),
    String(limit),
  ];

  const runFetch = () =>
    fetchCampaignIntelligencePage(ctx.admin, ctx.scope, {
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
      eventId: opts.eventId,
      search: opts.search,
      offset: opts.offset,
      limit: opts.limit,
    });

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
    const msg = e instanceof Error ? e.message : 'Failed to load campaign intelligence';
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
