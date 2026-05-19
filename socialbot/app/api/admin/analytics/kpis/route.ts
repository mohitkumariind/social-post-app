import { NextResponse } from 'next/server';
import { fetchAnalyticsKpis } from '@/lib/admin/analyticsApi';
import { requireAdminAnalyticsContext } from '../_lib';

export async function GET() {
  const ctx = await requireAdminAnalyticsContext();
  if (!ctx.ok) return ctx.response;

  const result = await fetchAnalyticsKpis(ctx.admin, ctx.scope);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } });
}
