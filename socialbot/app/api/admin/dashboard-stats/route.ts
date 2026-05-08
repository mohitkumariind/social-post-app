import { NextResponse } from 'next/server';
import { createServiceRoleClient, validateAdminSession } from '@/lib/admin-gate';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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
  if (auth.role === 'moderator' && auth.assigned_state_id == null) {
    return NextResponse.json({ error: 'Moderator is missing assigned_state_id' }, { status: 403 });
  }

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  const [
    usersCountRes,
    postsCountRes,
    eventsCountRes,
    newUsersRes,
    recentPostsRes,
    upcomingEventsRes,
  ] = await Promise.all([
    auth.role === 'moderator'
      ? db.from('profiles').select('id', { count: 'exact', head: true }).eq('assigned_state_id', auth.assigned_state_id)
      : db.from('profiles').select('id', { count: 'exact', head: true }),
    db.from('posts').select('id', { count: 'exact', head: true }),
    db.from('events').select('id', { count: 'exact', head: true }),
    auth.role === 'moderator'
      ? db
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', startOfTodayIso())
          .eq('assigned_state_id', auth.assigned_state_id)
      : db.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', startOfTodayIso()),
    db.from('posts').select('id,title,created_at').order('created_at', { ascending: false }).limit(5),
    db.from('events').select('id,name,end').order('end', { ascending: true }).limit(3),
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
