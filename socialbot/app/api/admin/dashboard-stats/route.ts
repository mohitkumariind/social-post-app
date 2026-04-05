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

  const admin = createServiceRoleClient();
  const db = admin ?? supabase;

  const [
    usersCountRes,
    postsCountRes,
    eventsCountRes,
    newUsersRes,
    recentPostsRes,
    upcomingEventsRes,
    geoProfilesRes,
  ] = await Promise.all([
    db.from('profiles').select('id', { count: 'exact', head: true }),
    db.from('posts').select('id', { count: 'exact', head: true }),
    db.from('events').select('id', { count: 'exact', head: true }),
    db.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', startOfTodayIso()),
    db.from('posts').select('id,title,created_at').order('created_at', { ascending: false }).limit(5),
    db.from('events').select('id,name,end').order('end', { ascending: true }).limit(3),
    db.from('profiles').select('state, party').limit(2000),
  ]);

  const profiles = (geoProfilesRes.data || []) as Array<{ state?: string | null; party?: string | null }>;
  const countBy = (keyFn: (r: (typeof profiles)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of profiles) {
      const k = keyFn(r);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    let best: { key: string; count: number } | null = null;
    for (const [key, count] of m.entries()) {
      if (!best || count > best.count) best = { key, count };
    }
    return best;
  };

  const topState = countBy((r) => String(r.state ?? '').trim());
  const topParty = countBy((r) => String(r.party ?? '').trim());
  const geoReport: Array<{ label: string; value: string; sub: string }> = [];
  if (topState) geoReport.push({ label: 'Top State', value: topState.key, sub: `${topState.count} Users` });
  if (topParty) geoReport.push({ label: 'Top Party', value: topParty.key, sub: `${topParty.count} Users` });

  return NextResponse.json({
    totalUsers: typeof usersCountRes.count === 'number' ? usersCountRes.count : null,
    newUsersToday: typeof newUsersRes.count === 'number' ? newUsersRes.count : null,
    postsCount: typeof postsCountRes.count === 'number' ? postsCountRes.count : null,
    eventsCount: typeof eventsCountRes.count === 'number' ? eventsCountRes.count : null,
    recentPosts: (recentPostsRes.data || []) as Array<{ id: string; title: string | null; created_at?: string | null }>,
    upcomingEvents: (upcomingEventsRes.data || []) as Array<{ id: string; name: string; end?: string | null }>,
    geoReport,
    usedServiceRole: !!admin,
  });
}
