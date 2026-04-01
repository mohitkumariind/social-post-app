"use client";
import {
  Activity,
  BarChart3,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Flag,
  HardDrive,
  Layers,
  Layout,
  TrendingUp,
  Users
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

// --- TYPES FOR TS ---
interface PostPerformance {
  id: string;
  title: string;
  reach: string;
  shares: string;
  date: string;
}

interface GeoReport {
  label: string;
  value: string;
  sub: string;
}

interface AppHealthStat {
  id: number;
  label: string;
  value: string;
  subText: string;
  icon: React.ReactNode;
  color: string;
}

interface SecondaryStat {
  id: number;
  label: string;
  value: string;
  subText: string;
  icon: React.ReactNode;
  color: string;
}

interface UpcomingEvent {
  id: string;
  name: string;
  date: string;
  color: string;
}

export default function Dashboard() {
  const [postPage, setPostPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [newUsersToday, setNewUsersToday] = useState<number | null>(null);
  const [postsCount, setPostsCount] = useState<number | null>(null);
  const [eventsCount, setEventsCount] = useState<number | null>(null);
  const [recentPosts, setRecentPosts] = useState<PostPerformance[]>([]);
  const [geoReport, setGeoReport] = useState<GeoReport[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);

  const fmtDateShort = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  useEffect(() => {
    let cancelled = false;

    const startOfTodayIso = () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return start.toISOString();
    };

    (async () => {
      setLoading(true);
      try {
        const [
          usersCountRes,
          postsCountRes,
          eventsCountRes,
          newUsersRes,
          recentPostsRes,
          upcomingEventsRes,
          geoProfilesRes,
        ] = await Promise.all([
          supabase.from('profiles').select('id', { count: 'exact', head: true }),
          supabase.from('posts').select('id', { count: 'exact', head: true }),
          supabase.from('events').select('id', { count: 'exact', head: true }),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', startOfTodayIso()),
          supabase.from('posts').select('id,title,created_at').order('created_at', { ascending: false }).limit(5),
          supabase.from('events').select('id,name,end').order('end', { ascending: true }).limit(3),
          // Used only to compute "Top State/Party" from real profile rows.
          supabase.from('profiles').select('state, party').limit(2000),
        ]);

        if (cancelled) return;

        setTotalUsers(typeof usersCountRes.count === 'number' ? usersCountRes.count : null);
        setPostsCount(typeof postsCountRes.count === 'number' ? postsCountRes.count : null);
        setEventsCount(typeof eventsCountRes.count === 'number' ? eventsCountRes.count : null);
        setNewUsersToday(typeof newUsersRes.count === 'number' ? newUsersRes.count : null);

        const postsRows = (recentPostsRes.data || []) as Array<{ id: string; title: string | null; created_at?: string | null }>;
        setRecentPosts(
          postsRows.map((p) => ({
            id: p.id,
            title: String(p.title ?? '').trim() || '—',
            reach: '—',
            shares: '—',
            date: fmtDateShort(p.created_at),
          }))
        );

        const eventsRows = (upcomingEventsRes.data || []) as Array<{ id: string; name: string; end?: string | null }>;
        setUpcomingEvents(
          eventsRows.map((e, idx) => ({
            id: e.id ?? e.name,
            name: e.name,
            date: fmtDateShort(e.end),
            color: idx % 3 === 0 ? 'border-orange-500' : idx % 3 === 1 ? 'border-red-500' : 'border-blue-500',
          }))
        );

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

        const nextGeo: GeoReport[] = [];
        if (topState) nextGeo.push({ label: 'Top State', value: topState.key, sub: `${topState.count} Users` });
        if (topParty) nextGeo.push({ label: 'Top Party', value: topParty.key, sub: `${topParty.count} Users` });
        setGeoReport(nextGeo);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 1. TOP STATS GRID (real data; no dummy)
  const topStats = useMemo(
    () => [
      { id: 1, label: 'Total Users', value: totalUsers != null ? String(totalUsers) : '—', color: 'bg-blue-600', shadow: 'shadow-blue-100' },
      { id: 2, label: 'New User Today', value: newUsersToday != null ? `+${newUsersToday}` : '—', color: 'bg-emerald-600', shadow: 'shadow-emerald-100' },
      { id: 3, label: 'Total Posts', value: postsCount != null ? String(postsCount) : '—', color: 'bg-orange-500', shadow: 'shadow-orange-100' },
      { id: 4, label: 'Active Campaigns', value: eventsCount != null ? String(eventsCount) : '—', color: 'bg-indigo-600', shadow: 'shadow-indigo-100' },
      { id: 5, label: '—', value: '—', color: 'bg-red-600', shadow: 'shadow-red-100' },
    ],
    [totalUsers, newUsersToday, postsCount, eventsCount]
  );

  // 2. APP HEALTH (no dummy values; placeholders only)
  const appHealthStats: AppHealthStat[] = useMemo(
    () => [
      { id: 1, label: 'System Stability', value: '—', subText: 'Crash-Free Sessions', icon: <Activity className="text-emerald-600" size={24} />, color: 'bg-emerald-50' },
      { id: 2, label: 'User Engagement', value: '—', subText: 'Avg. Session Time', icon: <TrendingUp className="text-blue-600" size={24} />, color: 'bg-blue-50' },
      { id: 3, label: 'Resource Usage', value: '—', subText: 'Cloud Storage Used', icon: <HardDrive className="text-orange-600" size={24} />, color: 'bg-orange-50' },
    ],
    []
  );

  const secondaryStats: SecondaryStat[] = useMemo(
    () => [
      { id: 1, label: 'Total Posts', value: postsCount != null ? String(postsCount) : '—', subText: 'In Library', icon: <Flag className="text-indigo-600" size={28} />, color: 'border-indigo-100' },
      { id: 2, label: 'Total Campaigns', value: eventsCount != null ? String(eventsCount) : '—', subText: 'In Events', icon: <Layers className="text-blue-600" size={28} />, color: 'border-blue-100' },
    ],
    [postsCount, eventsCount]
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20 text-slate-700">
      
      {/* HEADER */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">SocialBot Dashboard</h1>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mt-3 leading-none">Live Performance Metrics</p>
        </div>
        <div className="hidden md:flex bg-white px-6 py-3 rounded-2xl border border-slate-100 shadow-sm items-center gap-3">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-xs font-black uppercase text-slate-500 tracking-tighter">Live Tracker: 2026</span>
        </div>
      </div>

      {/* 1. TOP STATS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {topStats.map((stat) => (
          <div key={stat.id} className="bg-white p-6 rounded-[35px] border border-slate-100 shadow-sm hover:shadow-md transition-all">
            <div className={`${stat.color} w-10 h-10 rounded-xl flex items-center justify-center text-white mb-4 shadow-lg ${stat.shadow}`}>
              <Users size={20} />
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 leading-tight">{stat.label}</p>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{stat.value}</h2>
          </div>
        ))}
      </div>

      {/* 2. MIDDLE SECTION: CONTENT & GEO REPORT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-[40px] border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          <div className="p-8 border-b border-slate-50 flex justify-between items-center">
             <div className="flex items-center gap-3">
                <BarChart3 className="text-blue-600" />
                <h3 className="font-black text-slate-900 text-lg">Live Content Reach</h3>
             </div>
             <div className="flex gap-2">
                <button onClick={() => setPostPage(1)} className="p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"><ChevronLeft size={16}/></button>
                <button onClick={() => setPostPage(1)} className="p-2 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"><ChevronRight size={16}/></button>
             </div>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                <th className="px-8 py-4">Post Title</th>
                <th className="px-8 py-4 text-center">Reach</th>
                <th className="px-8 py-4 text-center">Shares</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(recentPosts.length > 0 ? recentPosts : []).map((post) => (
                <tr key={post.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-5 font-bold text-slate-800">{post.title}</td>
                  <td className="px-8 py-5 text-center font-black text-slate-500">{post.reach}</td>
                  <td className="px-8 py-5 text-center">
                    <span className="bg-blue-50 text-blue-600 px-3 py-1 rounded-full text-xs font-black">{post.shares}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-slate-900 rounded-[40px] p-8 text-white shadow-2xl flex flex-col">
          <div className="flex items-center gap-3 mb-8">
            <Layout className="text-blue-400" size={20} />
            <h3 className="font-black text-lg uppercase tracking-tight leading-none">Geography Report</h3>
          </div>
          <div className="space-y-4 flex-1">
            {geoReport.map((item) => (
              <div key={item.label} className="bg-white/5 p-5 rounded-[25px] border border-white/5 transition-all hover:bg-white/10">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">{item.label}</p>
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-200">{item.value}</span>
                  <span className="bg-blue-500/10 text-blue-400 px-3 py-1 rounded-lg text-[10px] font-black">{item.sub}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. APP HEALTH MONITORING (3 Metrics above Pipeline) */}
      <div className="space-y-4 pt-4">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] px-2 flex items-center gap-2">
           App Health Monitoring
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {appHealthStats.map((item) => (
            <div key={item.id} className="bg-white p-7 rounded-[40px] border border-slate-100 shadow-sm flex items-center gap-6 group hover:shadow-md transition-all">
              <div className={`${item.color} w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
                {item.icon}
              </div>
              <div>
                <h4 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-1">{item.value}</h4>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{item.label}</p>
                <p className="text-[9px] font-bold text-slate-300 uppercase leading-none">{item.subText}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. ACTIVE PARTY & ASSEMBLY SUMMARY */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
        {secondaryStats.map((item) => (
          <div key={item.id} className={`bg-white p-8 rounded-[40px] border-2 ${item.color} shadow-sm flex items-center justify-between group hover:shadow-xl transition-all`}>
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 bg-slate-50 rounded-[24px] flex items-center justify-center group-hover:scale-110 transition-transform">
                {item.icon}
              </div>
              <div>
                <h3 className="text-4xl font-black text-slate-900 tracking-tighter leading-none mb-1">{item.value}</h3>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{item.label}</p>
              </div>
            </div>
            <p className="text-[10px] font-black text-slate-300 uppercase hidden sm:block">{item.subText}</p>
          </div>
        ))}
      </div>

      {/* 5. UPCOMING PIPELINE */}
      <div className="space-y-4 pt-4">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] px-2 flex items-center gap-2">
          <Calendar size={14} className="text-orange-500" /> Upcoming Event Pipeline
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {upcomingEvents.map((event) => (
            <div key={event.id} className={`bg-white p-6 rounded-[35px] border-l-8 ${event.color} border border-slate-100 shadow-sm flex items-center justify-between group hover:shadow-md transition-all`}>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Target Date: {event.date}</p>
                <h4 className="text-lg font-black text-slate-900 leading-tight">{event.name}</h4>
              </div>
              <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-300 group-hover:text-slate-900 transition-colors">
                <ChevronRight size={20} />
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
