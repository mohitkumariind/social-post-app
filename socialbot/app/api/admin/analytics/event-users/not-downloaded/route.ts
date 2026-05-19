import { NextRequest, NextResponse } from 'next/server';
import { fetchEventUsersNotDownloadedPage, parseAnalyticsDateRange, parseAnalyticsPagination } from '@/lib/admin/analyticsApi';
import { assertEventReadableForAdminAnalytics } from '@/lib/admin/assert-event-analytics-scope';
import { requireAdminAnalyticsContext } from '../../_lib';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/analytics/event-users/not-downloaded
 *
 * Query: event_id (required), search, offset, limit.
 * RBAC scope is resolved in {@link requireAdminAnalyticsContext} before the drilldown RPC.
 */
export async function GET(request: NextRequest) {
  const ctx = await requireAdminAnalyticsContext();
  if (!ctx.ok) return ctx.response;

  const sp = request.nextUrl.searchParams;
  const eventId = (sp.get('event_id') ?? '').trim();
  if (!UUID_RE.test(eventId)) {
    return NextResponse.json({ error: 'Invalid or missing event_id' }, { status: 400 });
  }

  const evOk = await assertEventReadableForAdminAnalytics(ctx.admin, ctx.scope, eventId);
  if (!evOk.ok) {
    return NextResponse.json({ error: evOk.error }, { status: evOk.status });
  }

  const { offset, limit } = parseAnalyticsPagination(sp);
  const searchRaw = sp.get('search');
  const { dateFrom, dateTo } = parseAnalyticsDateRange(sp);
  if ((dateFrom == null) !== (dateTo == null)) {
    return NextResponse.json({ error: 'Provide both date_from and date_to, or neither' }, { status: 400 });
  }

  const result = await fetchEventUsersNotDownloadedPage(ctx.admin, ctx.scope, eventId, {
    search: searchRaw != null ? String(searchRaw) : null,
    offset,
    limit,
    dateFrom,
    dateTo,
  });
  if (!result.ok) {
    const st = /invalid event_id/i.test(result.error) ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status: st });
  }

  return NextResponse.json(result.data, {
    headers: {
      // Short private cache: reduces repeat drilldown load; RBAC is enforced before this response is built.
      'Cache-Control': 'private, max-age=20, stale-while-revalidate=40',
      Vary: 'Cookie',
    },
  });
}
