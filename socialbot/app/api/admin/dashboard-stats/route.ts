import { NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  buildScopedAnalyticsQuery,
  resolveAllowedProfileIdsForCampaignManager,
} from '@/lib/rbac/scoped-query-builder';

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
  if (auth.role === 'moderator' && auth.assigned_state_ids.length === 0) {
    return NextResponse.json({ error: 'Moderator is missing assigned_state_ids' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  const scopedUser = {
    id: auth.user.id,
    role: auth.role,
    assigned_state_ids: auth.assigned_state_ids,
    assigned_group_ids: auth.assigned_group_ids,
  } as any;

  const allowed_profile_ids =
    auth.role === 'campaign_manager'
      ? await resolveAllowedProfileIdsForCampaignManager(db as any, auth.assigned_group_ids)
      : null;

  const [
    usersCountRes,
    postsCountRes,
    eventsCountRes,
    newUsersRes,
    recentPostsRes,
    upcomingEventsRes,
  ] = await Promise.all([
    buildScopedAnalyticsQuery(
      scopedUser,
      db.from('profiles').select('id', { count: 'exact', head: true }),
      'profiles',
      { allowed_profile_ids: allowed_profile_ids ?? undefined }
    ),
    // Posts count (best-effort): exclude deleted/scheduled-not-due when columns exist.
    (async () => {
      const nowIso = new Date().toISOString();
      const base = db
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published')
        .is('deleted_at', null)
        .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`);
      const r = await buildScopedAnalyticsQuery(scopedUser, base as any, 'posts');
      if ((r as any)?.error && String((r as any).error.message ?? '').includes('does not exist')) {
        const fallback = db.from('posts').select('id', { count: 'exact', head: true });
        return await buildScopedAnalyticsQuery(scopedUser, fallback as any, 'posts');
      }
      return r as any;
    })(),
    buildScopedAnalyticsQuery(scopedUser, db.from('events').select('id', { count: 'exact', head: true }) as any, 'events'),
    buildScopedAnalyticsQuery(
      scopedUser,
      db.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', startOfTodayIso()),
      'profiles',
      { allowed_profile_ids: allowed_profile_ids ?? undefined }
    ),
    // Recent posts: admin-only (hide for moderator + campaign_manager)
    auth.role === 'admin'
      ? (async () => {
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
            return await db.from('posts').select('id,title,created_at').order('created_at', { ascending: false }).limit(5);
          }
          return r as any;
        })()
      : ({ data: [], error: null } as any),
    buildScopedAnalyticsQuery(
      scopedUser,
      db.from('events').select('id,name,end').order('end', { ascending: true }).limit(3) as any,
      'events'
    ),
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
