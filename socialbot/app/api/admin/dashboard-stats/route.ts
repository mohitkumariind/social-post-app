import { NextResponse } from 'next/server';
import {
  assertAdminRole,
  createServiceRoleClient,
  isAdmin,
  isCampaignManager,
  validateAdminSession,
} from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  buildScopedAnalyticsQuery,
  resolveAllowedProfileIdsForCampaignManager,
  resolveEffectiveGroupIdsForCampaignManager,
} from '@/lib/rbac/scoped-query-builder';
import { RbacError, requireModeratorHasAssignedStates, requireRole } from '@/lib/rbac/require';

function isMissingColumnErr(err: { message?: string } | null | undefined, columnName: string) {
  const msg = String(err?.message ?? '').toLowerCase();
  return msg.includes(columnName.toLowerCase()) && (msg.includes('does not exist') || msg.includes('column') || msg.includes('schema cache'));
}

export type DashboardEventRow = {
  id: string;
  name: string;
  end?: string | null;
  start?: string | null;
  status?: string | null;
  scheduled_at?: string | null;
};

function startOfTodayIso(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return start.toISOString();
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const auth = await validateAdminSession(supabase);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }, { status: auth.status });
  }
  try {
    requireRole(auth, ['admin', 'moderator', 'campaign_manager']);
    requireModeratorHasAssignedStates(auth);
  } catch (e) {
    if (e instanceof RbacError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  if (!admin) {
    // No JWT fallback in /api/admin/*: avoid implicit RLS-scoped reads.
    return NextResponse.json(
      { error: 'Admin analytics access requires SUPABASE_SERVICE_ROLE_KEY' },
      { status: 503 }
    );
  }
  const db = admin;

  const adminRole = isAdmin(auth);
  if (adminRole) assertAdminRole(auth);

  let cmEffectiveGroupIds: string[] | undefined;
  if (isCampaignManager(auth)) {
    const eff = await resolveEffectiveGroupIdsForCampaignManager(db, auth.user.id, auth.assigned_group_ids);
    if (eff === null) {
      return NextResponse.json({ error: 'Unable to resolve group assignments' }, { status: 500 });
    }
    if (eff.length === 0) {
      return NextResponse.json({ error: 'Campaign manager is missing assigned_group_ids' }, { status: 403 });
    }
    cmEffectiveGroupIds = eff;
  }

  const scopedUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  } as any;
  const cmAnalyticsCtx = {
    allowed_profile_ids: undefined as string[] | undefined,
    effective_group_ids: undefined as string[] | undefined,
  };
  if (isCampaignManager(auth) && cmEffectiveGroupIds) {
    cmAnalyticsCtx.effective_group_ids = cmEffectiveGroupIds;
    cmAnalyticsCtx.allowed_profile_ids = (await resolveAllowedProfileIdsForCampaignManager(
      db as any,
      cmEffectiveGroupIds
    )) ?? undefined;
  }

  const runProfilesCount = (createdTodayOnly: boolean) => {
    let q = db.from('profiles').select('id', { count: 'exact', head: true });
    if (createdTodayOnly) q = q.gte('created_at', startOfTodayIso());
    if (adminRole) return q as any;
    return buildScopedAnalyticsQuery(scopedUser, q as any, 'profiles', {
      allowed_profile_ids: cmAnalyticsCtx.allowed_profile_ids,
      effective_group_ids: cmAnalyticsCtx.effective_group_ids,
    }) as any;
  };

  const runPostsCount = async () => {
    const nowIso = new Date().toISOString();
    const withPostsScope = (q: any) =>
      adminRole ? q : buildScopedAnalyticsQuery(scopedUser, q as any, 'posts', { effective_group_ids: cmAnalyticsCtx.effective_group_ids });

    /** Try progressively simpler filters so legacy schemas (missing status/deleted_at/scheduled_at) still return a number. */
    const builders = [
      () =>
        db.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'published').is('deleted_at', null),
      () =>
        db
          .from('posts')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'published')
          .is('deleted_at', null)
          .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`),
      () => db.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      () => db.from('posts').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      () => db.from('posts').select('id', { count: 'exact', head: true }),
    ];

    let last: { count: number | null; error: unknown } = { count: null, error: null };
    for (const build of builders) {
      const res = (await withPostsScope(build())) as { count: number | null; error: unknown };
      last = res;
      if (!res.error && typeof res.count === 'number') return res;
    }
    return last;
  };

  const runEventsCount = () => {
    const q = db.from('events').select('id', { count: 'exact', head: true });
    return adminRole
      ? (q as any)
      : (buildScopedAnalyticsQuery(scopedUser, q as any, 'events', {
          effective_group_ids: cmAnalyticsCtx.effective_group_ids,
        }) as any);
  };

  const nowIso = new Date().toISOString();

  const applyEventsScope = (qIn: any) =>
    adminRole
      ? qIn
      : buildScopedAnalyticsQuery(scopedUser, qIn as any, 'events', {
          effective_group_ids: cmAnalyticsCtx.effective_group_ids,
        });

  /** Published = status published (soft-delete excluded). Legacy DB without `status`: non-deleted rows that are not future-scheduled. */
  const runPublishedEventsList = async (): Promise<{ data: DashboardEventRow[]; error: unknown }> => {
    const selectFull = 'id,name,end,start,status,scheduled_at';
    const selectLite = 'id,name,end,start,scheduled_at';
    const selectMin = 'id,name,end,start';

    const run = async (q: any) => {
      const scoped = applyEventsScope(q);
      return scoped as any;
    };

    let res = await run(
      db.from('events').select(selectFull).is('deleted_at', null).eq('status', 'published').order('end', { ascending: false }).limit(40)
    );
    if (res.error && isMissingColumnErr(res.error, 'status')) {
      res = await run(
        db
          .from('events')
          .select(selectLite)
          .is('deleted_at', null)
          .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
          .order('end', { ascending: false })
          .limit(40)
      );
    }
    if (res.error && isMissingColumnErr(res.error, 'deleted_at')) {
      res = await run(
        db.from('events').select(selectFull).eq('status', 'published').order('end', { ascending: false }).limit(40)
      );
    }
    if (res.error && isMissingColumnErr(res.error, 'status')) {
      res = await run(
        db
          .from('events')
          .select(selectLite)
          .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
          .order('end', { ascending: false })
          .limit(40)
      );
    }
    if (res.error && isMissingColumnErr(res.error, 'scheduled_at')) {
      res = await run(db.from('events').select(selectMin).is('deleted_at', null).order('end', { ascending: false }).limit(40));
    }
    if (res.error && isMissingColumnErr(res.error, 'deleted_at')) {
      res = await run(db.from('events').select(selectMin).order('end', { ascending: false }).limit(40));
    }
    return { data: (res.data || []) as DashboardEventRow[], error: res.error };
  };

  const runScheduledEventsList = async (): Promise<{ data: DashboardEventRow[]; error: unknown }> => {
    const selectFull = 'id,name,end,start,status,scheduled_at';
    const selectLite = 'id,name,end,start,scheduled_at';

    const run = async (q: any) => applyEventsScope(q) as any;

    let res = await run(
      db
        .from('events')
        .select(selectFull)
        .is('deleted_at', null)
        .eq('status', 'scheduled_publish')
        .gt('scheduled_at', nowIso)
        .order('scheduled_at', { ascending: true })
        .limit(40)
    );
    if (res.error && isMissingColumnErr(res.error, 'status')) {
      res = await run(
        db.from('events').select(selectLite).is('deleted_at', null).gt('scheduled_at', nowIso).order('scheduled_at', { ascending: true }).limit(40)
      );
    }
    if (res.error && isMissingColumnErr(res.error, 'deleted_at')) {
      res = await run(
        db
          .from('events')
          .select(selectFull)
          .eq('status', 'scheduled_publish')
          .gt('scheduled_at', nowIso)
          .order('scheduled_at', { ascending: true })
          .limit(40)
      );
    }
    if (res.error && isMissingColumnErr(res.error, 'status')) {
      res = await run(db.from('events').select(selectLite).gt('scheduled_at', nowIso).order('scheduled_at', { ascending: true }).limit(40));
    }
    if (res.error && isMissingColumnErr(res.error, 'scheduled_at')) {
      return { data: [], error: null };
    }
    return { data: (res.data || []) as DashboardEventRow[], error: res.error };
  };

  const [usersCountRes, postsCountRes, eventsCountRes, newUsersRes, publishedEventsRes, scheduledEventsRes] = await Promise.all([
    runProfilesCount(false),
    runPostsCount(),
    runEventsCount(),
    runProfilesCount(true),
    runPublishedEventsList(),
    runScheduledEventsList(),
  ]);

  return NextResponse.json({
    totalUsers: typeof usersCountRes.count === 'number' ? usersCountRes.count : null,
    newUsersToday: typeof newUsersRes.count === 'number' ? newUsersRes.count : null,
    postsCount: typeof postsCountRes.count === 'number' ? postsCountRes.count : null,
    eventsCount: typeof eventsCountRes.count === 'number' ? eventsCountRes.count : null,
    publishedEvents: publishedEventsRes.data ?? [],
    scheduledEvents: scheduledEventsRes.data ?? [],
    usedServiceRole: !!admin,
  });
}
