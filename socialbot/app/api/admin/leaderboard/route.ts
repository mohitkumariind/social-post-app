import { NextRequest, NextResponse } from 'next/server';
import {
  assertLeaderboardFiltersAllowed,
  ADMIN_LB_EXPORT_MAX_ROWS,
  fetchAdminLeaderboardPage,
  fetchAllLeaderboardRowsForExport,
  fetchStateFilterOptions,
  resolveCmGroupIdsForLeaderboard,
} from '@/lib/admin/leaderboardService';
import { createServiceRoleClient, isCampaignManager, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  RbacError,
  requireCampaignManagerHasAssignedGroups,
  requireModeratorHasAssignedStates,
  requireRole,
} from '@/lib/rbac/require';
import { API_DEFAULT_LIMIT, clampLimit } from '@/lib/perf-defaults';

function csvEscapeCell(v: string): string {
  const s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) return `'${s.replace(/'/g, "''")}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toVerifiedAuth(auth: Awaited<ReturnType<typeof validateAdminSession>> & { ok: true }) {
  return {
    role: auth.role,
    user: { id: auth.user.id },
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  };
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const session = await validateAdminSession(supabase);
  if (!session.ok) {
    return NextResponse.json({ error: session.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: session.status });
  }
  try {
    requireRole(session, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(session);
    requireCampaignManagerHasAssignedGroups(session);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY required for leaderboard' }, { status: 503 });
  }

  const auth = toVerifiedAuth(session);
  const sp = request.nextUrl.searchParams;

  if (sp.get('meta') === 'states') {
    const states = await fetchStateFilterOptions(admin, auth);
    return NextResponse.json({ states }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const cmEff = await resolveCmGroupIdsForLeaderboard(admin, auth);
  if (isCampaignManager(session) && cmEff === null) {
    return NextResponse.json({ error: 'Unable to resolve group assignments' }, { status: 500 });
  }
  if (isCampaignManager(session) && cmEff && cmEff.length === 0) {
    return NextResponse.json({ error: 'Campaign manager is missing assigned_group_ids' }, { status: 403 });
  }

  const cmNumericAllowed =
    isCampaignManager(session) && Array.isArray(cmEff)
      ? cmEff.map((x) => Number(x)).filter((n) => Number.isSafeInteger(n) && n > 0)
      : undefined;

  const search = (sp.get('search') ?? '').trim();
  const stateIdRaw = sp.get('state_id');
  const stateId = stateIdRaw && stateIdRaw.trim() !== '' ? Number(stateIdRaw) : null;
  const party = (sp.get('party') ?? '').trim();
  const groupIdRaw = sp.get('group_id');
  const groupId = groupIdRaw && groupIdRaw.trim() !== '' ? Number(groupIdRaw) : null;

  const dateFromStr = sp.get('date_from');
  const dateToStr = sp.get('date_to');
  const dateFrom = dateFromStr ? new Date(dateFromStr) : new Date(Date.now() - 30 * 86400000);
  const dateTo = dateToStr ? new Date(dateToStr) : new Date();
  if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
    return NextResponse.json({ error: 'Invalid date_from / date_to' }, { status: 400 });
  }
  if (dateFrom > dateTo) {
    return NextResponse.json({ error: 'date_from must be before date_to' }, { status: 400 });
  }

  const offset = Math.max(0, Math.min(Number(sp.get('offset') ?? 0) || 0, 50_000));
  const limit = clampLimit(sp.get('limit'), API_DEFAULT_LIMIT, 200);

  const gate = assertLeaderboardFiltersAllowed(
    auth,
    { stateId: stateId && Number.isFinite(stateId) ? stateId : null, party, groupId: groupId && Number.isFinite(groupId) ? groupId : null },
    { cmAllowedNumericGroupIds: cmNumericAllowed }
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message }, { status: gate.status });
  }

  const filters = {
    search,
    stateId: stateId && Number.isFinite(stateId) ? stateId : null,
    party,
    groupId: groupId && Number.isFinite(groupId) ? groupId : null,
    dateFrom,
    dateTo,
    offset,
    limit,
  };

  if (sp.get('export') === 'csv') {
    const pack = await fetchAllLeaderboardRowsForExport(admin, auth, filters, cmEff);
    if ('error' in pack) {
      return NextResponse.json({ error: pack.error }, { status: 500 });
    }
    if (pack.truncated) {
      return NextResponse.json(
        { error: `Export would exceed ${ADMIN_LB_EXPORT_MAX_ROWS} rows; narrow filters or date range.` },
        { status: 400 }
      );
    }
    const rows = pack.rows;
    const headers = ['rank', 'profile_id', 'name', 'state', 'party', 'group_id', 'group_name', 'points', 'last_active', 'phone'];
    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.rank,
          r.profile_id,
          csvEscapeCell(r.name),
          csvEscapeCell(r.state),
          csvEscapeCell(r.party),
          r.group_id ?? '',
          csvEscapeCell(r.group_name),
          r.points,
          r.last_active ? csvEscapeCell(r.last_active) : '',
          r.phone ? csvEscapeCell(r.phone) : '',
        ].join(',')
      ),
    ];
    const body = lines.join('\r\n');
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leaderboard-export.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const result = await fetchAdminLeaderboardPage(admin, auth, filters, cmEff);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
