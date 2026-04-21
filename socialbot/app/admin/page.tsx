"use client";
import { BarChart3, Calendar, ChevronRight, Users } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

interface PostRow {
  id: string;
  title: string;
  date: string;
}

interface UpcomingEvent {
  id: string;
  name: string;
  date: string;
  color: string;
}

export default function Dashboard() {
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [newUsersToday, setNewUsersToday] = useState<number | null>(null);
  const [postsCount, setPostsCount] = useState<number | null>(null);
  const [eventsCount, setEventsCount] = useState<number | null>(null);
  const [recentPosts, setRecentPosts] = useState<PostRow[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);

  const fmtDateShort = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetch('/api/admin/dashboard-stats', { credentials: 'same-origin' });
      if (!res.ok) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[dashboard] dashboard-stats', res.status, await res.text());
        }
        return;
      }
      const payload = (await res.json()) as {
        totalUsers: number | null;
        newUsersToday: number | null;
        postsCount: number | null;
        eventsCount: number | null;
        recentPosts: Array<{ id: string; title: string | null; created_at?: string | null }>;
        upcomingEvents: Array<{ id: string; name: string; end?: string | null }>;
      };

      if (cancelled) return;

      setTotalUsers(payload.totalUsers);
      setPostsCount(payload.postsCount);
      setEventsCount(payload.eventsCount);
      setNewUsersToday(payload.newUsersToday);

      setRecentPosts(
        (payload.recentPosts || []).map((p) => ({
          id: p.id,
          title: String(p.title ?? '').trim() || '—',
          date: fmtDateShort(p.created_at),
        }))
      );

      setUpcomingEvents(
        (payload.upcomingEvents || []).map((e, idx) => ({
          id: e.id ?? e.name,
          name: e.name,
          date: fmtDateShort(e.end),
          color: idx % 3 === 0 ? 'border-orange-500' : idx % 3 === 1 ? 'border-red-500' : 'border-blue-500',
        }))
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const topStats = useMemo(
    () => [
      { id: 1, label: 'Total Users', value: totalUsers != null ? String(totalUsers) : '—', color: 'bg-blue-600', shadow: 'shadow-blue-100' },
      { id: 2, label: 'New User Today', value: newUsersToday != null ? `+${newUsersToday}` : '—', color: 'bg-emerald-600', shadow: 'shadow-emerald-100' },
      { id: 3, label: 'Total Posts', value: postsCount != null ? String(postsCount) : '—', color: 'bg-orange-500', shadow: 'shadow-orange-100' },
      { id: 4, label: 'Active Campaigns', value: eventsCount != null ? String(eventsCount) : '—', color: 'bg-indigo-600', shadow: 'shadow-indigo-100' },
    ],
    [totalUsers, newUsersToday, postsCount, eventsCount]
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20 text-slate-200">

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tight">SocialBot Dashboard</h1>
          <p className="text-sm font-bold text-zinc-400 uppercase tracking-widest mt-3 leading-none">Live Performance Metrics</p>
        </div>
        <div className="hidden md:flex bg-white px-6 py-3 rounded-2xl border border-slate-100 shadow-sm items-center gap-3">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-xs font-black uppercase text-slate-500 tracking-tighter">Live Tracker: 2026</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-[40px] border border-slate-100 shadow-sm flex flex-col overflow-hidden">
          <div className="p-8 border-b border-slate-50 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <BarChart3 className="text-blue-600" />
              <h3 className="font-black text-slate-900 text-lg">Recent posts</h3>
            </div>
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-50">
                <th className="px-8 py-4">Post title</th>
                <th className="px-8 py-4 text-right">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {recentPosts.map((post) => (
                <tr key={post.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-5 font-bold text-slate-800">{post.title}</td>
                  <td className="px-8 py-5 text-right font-black text-slate-500">{post.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
