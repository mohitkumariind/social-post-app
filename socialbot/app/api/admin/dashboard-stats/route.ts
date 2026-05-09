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
    const base = db
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .is('deleted_at', null)
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`);
    const r = adminRole
      ? (base as any)
      : ((await buildScopedAnalyticsQuery(scopedUser, base as any, 'posts', {
          effective_group_ids: cmAnalyticsCtx.effective_group_ids,
        })) as any);
    if ((r as any)?.error && String((r as any).error.message ?? '').includes('does not exist')) {
      const fallback = db.from('posts').select('id', { count: 'exact', head: true });
      return adminRole
        ? (fallback as any)
        : ((await buildScopedAnalyticsQuery(scopedUser, fallback as any, 'posts', {
            effective_group_ids: cmAnalyticsCtx.effective_group_ids,
          })) as any);
    }
    return r as any;
  };

  const runEventsCount = () => {
    const q = db.from('events').select('id', { count: 'exact', head: true });
    return adminRole
      ? (q as any)
      : (buildScopedAnalyticsQuery(scopedUser, q as any, 'events', {
          effective_group_ids: cmAnalyticsCtx.effective_group_ids,
        }) as any);
  };

  const runUpcomingEvents = () => {
    const q = db.from('events').select('id,name,end').order('end', { ascending: true }).limit(3);
    return adminRole
      ? (q as any)
      : (buildScopedAnalyticsQuery(scopedUser, q as any, 'events', {
          effective_group_ids: cmAnalyticsCtx.effective_group_ids,
        }) as any);
  };

  const runRecentPosts = async () => {
    if (!adminRole) return { data: [], error: null } as any;
    const nowIso = new Date().toISOString();
    const r = await db
      .from('posts')
      .select('id,title,created_at')
      .eq('status', 'published')
      .is('deleted_at', null)
      .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
      .order('created_at', { ascending: false })
      .limit(5);
    if ((r as any)?.error && String((r as any).error.message ?? '').includes('does not exist')) {
      return (await db.from('posts').select('id,title,created_at').order('created_at', { ascending: false }).limit(5)) as any;
    }
    return r as any;
  };

  const [usersCountRes, postsCountRes, eventsCountRes, newUsersRes, recentPostsRes, upcomingEventsRes] =
    await Promise.all([
      runProfilesCount(false),
      runPostsCount(),
      runEventsCount(),
      runProfilesCount(true),
      runRecentPosts(),
      runUpcomingEvents(),
    ]);

  return NextResponse.json({
    totalUsers: typeof usersCountRes.count === 'number' ? usersCountRes.count : null,
    newUsersToday: typeof newUsersRes.count === 'number' ? newUsersRes.count : null,
    postsCount: typeof postsCountRes.count === 'number' ? postsCountRes.count : null,
    eventsCount: typeof eventsCountRes.count === 'number' ? eventsCountRes.count : null,
    recentPosts: (recentPostsRes.data || []) as Array<{ id: string; title: string | null; created_at?: string | null }>,
    upcomingEvents: (upcomingEventsRes.data || []) as Array<{ id: string; name: string; end?: string | null }>,
    usedServiceRole: !!admin,
  });
}
