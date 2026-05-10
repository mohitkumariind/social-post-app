import { NextRequest, NextResponse } from 'next/server';
import { fetchAnalyticsKpis, parseAnalyticsDateRange } from '@/lib/admin/analyticsApi';
import { requireAdminAnalyticsContext } from '../_lib';

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

  const result = await fetchAnalyticsKpis(ctx.admin, ctx.scope, { dateFrom, dateTo });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}
