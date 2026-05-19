import { NextRequest, NextResponse } from 'next/server';
import {
  assertAnalyticsGeoFiltersAllowed,
  buildAnalyticsExportCsv,
  parseAnalyticsDateRange,
  parseAnalyticsGeoFilters,
  type AnalyticsExportKind,
} from '@/lib/admin/analyticsApi';
import { assertEventReadableForAdminAnalytics } from '@/lib/admin/assert-event-analytics-scope';
import { requireAdminAnalyticsContext } from '../_lib';

const KINDS = new Set<AnalyticsExportKind>(['kpis', 'events', 'not_downloaded']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const ctx = await requireAdminAnalyticsContext();
  if (!ctx.ok) return ctx.response;

  const sp = request.nextUrl.searchParams;
  const kindRaw = (sp.get('kind') ?? '').trim().toLowerCase();
  if (!KINDS.has(kindRaw as AnalyticsExportKind)) {
    return NextResponse.json({ error: 'Invalid kind (use kpis | events | not_downloaded)' }, { status: 400 });
  }
  const kind = kindRaw as AnalyticsExportKind;

  const { dateFrom, dateTo } = parseAnalyticsDateRange(sp);
  if ((dateFrom == null) !== (dateTo == null)) {
    return NextResponse.json({ error: 'Provide both date_from and date_to, or neither' }, { status: 400 });
  }
  if (dateFrom && dateTo && dateFrom.getTime() > dateTo.getTime()) {
    return NextResponse.json({ error: 'date_from must be before or equal to date_to' }, { status: 400 });
  }

  const search = (sp.get('search') ?? '').trim();
  const eventId = (sp.get('event_id') ?? '').trim();
  if (kind === 'not_downloaded') {
    if (!UUID_RE.test(eventId)) {
      return NextResponse.json({ error: 'event_id is required and must be a UUID for not_downloaded export' }, { status: 400 });
    }
    const evOk = await assertEventReadableForAdminAnalytics(ctx.admin, ctx.scope, eventId);
    if (!evOk.ok) {
      return NextResponse.json({ error: evOk.error }, { status: evOk.status });
    }
  }

  const geo = parseAnalyticsGeoFilters(sp);
  if (kind === 'kpis') {
    const allowed = assertAnalyticsGeoFiltersAllowed(ctx.auth, geo);
    if (!allowed.ok) {
      return NextResponse.json({ error: allowed.message }, { status: allowed.status });
    }
  }

  const pack = await buildAnalyticsExportCsv(ctx.admin, ctx.scope, kind, {
    dateFrom,
    dateTo,
    search,
    eventId: eventId || null,
    stateId: geo.stateId,
    party: geo.party,
  });
  if (!pack.ok) {
    return NextResponse.json({ error: pack.error }, { status: 400 });
  }

  return new NextResponse(pack.csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${pack.filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
