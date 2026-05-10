import { NextRequest, NextResponse } from 'next/server';
import { fetchAnalyticsEventsPage, parseAnalyticsPagination } from '@/lib/admin/analyticsApi';
import { requireAdminAnalyticsContext } from '../_lib';

export async function GET(request: NextRequest) {
  const ctx = await requireAdminAnalyticsContext();
  if (!ctx.ok) return ctx.response;

  const sp = request.nextUrl.searchParams;
  const { offset, limit } = parseAnalyticsPagination(sp);
  const search = (sp.get('search') ?? '').trim();

  const result = await fetchAnalyticsEventsPage(ctx.admin, ctx.scope, { search, offset, limit });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}
