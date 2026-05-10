import { NextRequest, NextResponse } from 'next/server';
import { fetchAnalyticsNotDownloadedPage, parseAnalyticsPagination } from '@/lib/admin/analyticsApi';
import { requireAdminAnalyticsContext } from '../../_lib';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const ctx = await requireAdminAnalyticsContext();
  if (!ctx.ok) return ctx.response;

  const sp = request.nextUrl.searchParams;
  const eventId = (sp.get('event_id') ?? '').trim();
  if (!UUID_RE.test(eventId)) {
    return NextResponse.json({ error: 'Invalid or missing event_id' }, { status: 400 });
  }

  const { offset, limit } = parseAnalyticsPagination(sp);
  const search = (sp.get('search') ?? '').trim();

  const result = await fetchAnalyticsNotDownloadedPage(ctx.admin, ctx.scope, eventId, { search, offset, limit });
  if (!result.ok) {
    const st = /invalid event_id/i.test(result.error) ? 400 : 500;
    return NextResponse.json({ error: result.error }, { status: st });
  }

  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}
