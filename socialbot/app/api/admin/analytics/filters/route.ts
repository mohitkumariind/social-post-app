import { NextRequest, NextResponse } from 'next/server';
import {
  assertAnalyticsGeoFiltersAllowed,
  fetchAnalyticsFilterOptions,
  parseAnalyticsGeoFilters,
} from '@/lib/admin/analyticsApi';
import { requireAdminAnalyticsContext } from '../_lib';

export async function GET(request: NextRequest) {
  const ctx = await requireAdminAnalyticsContext();
  if (!ctx.ok) return ctx.response;

  const sp = request.nextUrl.searchParams;
  const { stateId } = parseAnalyticsGeoFilters(sp);
  const allowed = assertAnalyticsGeoFiltersAllowed(ctx.auth, { stateId, party: null });
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.message }, { status: allowed.status });
  }

  const result = await fetchAnalyticsFilterOptions(ctx.admin, ctx.auth, stateId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}
