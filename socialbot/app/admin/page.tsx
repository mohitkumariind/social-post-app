"use client";
import { Calendar, ChevronRight, Users } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';

const __DEV__ = process.env.NODE_ENV !== 'production';

interface DashboardEventCard {
  id: string;
  name: string;
  endLabel: string;
  subLabel: string;
  accent: string;
}

export default function Dashboard() {
  const [totalUsers, setTotalUsers] = useState<number | null>(null);
  const [newUsersToday, setNewUsersToday] = useState<number | null>(null);
  const [postsCount, setPostsCount] = useState<number | null>(null);
  const [eventsCount, setEventsCount] = useState<number | null>(null);
  const [publishedEvents, setPublishedEvents] = useState<DashboardEventCard[]>([]);
  const [scheduledEvents, setScheduledEvents] = useState<DashboardEventCard[]>([]);

  const fmtDateShort = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const fmtDateTimeShort = (iso: string | null | undefined) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await fetch('/api/admin/dashboard-stats', { credentials: 'same-origin' });
      if (!res.ok) {
        if (__DEV__) {
          console.warn('[dashboard] dashboard-stats', res.status, await res.text());
        }
        return;
      }
      const payload = (await res.json()) as {
        totalUsers: number | null;
        newUsersToday: number | null;
        postsCount: number | null;
        eventsCount: number | null;
        publishedEvents?: Array<{ id: string; name: string; end?: string | null; start?: string | null; scheduled_at?: string | null }>;
        scheduledEvents?: Array<{ id: string; name: string; end?: string | null; scheduled_at?: string | null }>;
      };

      if (cancelled) return;

      setTotalUsers(payload.totalUsers);
      setPostsCount(payload.postsCount);
      setEventsCount(payload.eventsCount);
      setNewUsersToday(payload.newUsersToday);

      const toPublishedCards = (
        rows: Array<{ id: string; name: string; end?: string | null; start?: string | null }>
      ): DashboardEventCard[] =>
        (rows || []).map((e, idx) => ({
          id: String(e.id ?? '').trim() || String(e.name ?? ''),
          name: String(e.name ?? '').trim() || '—',
          endLabel: fmtDateShort(e.end),
          subLabel: `Start ${fmtDateShort(e.start)}`,
          accent: idx % 3 === 0 ? 'border-emerald-500' : idx % 3 === 1 ? 'border-blue-500' : 'border-violet-500',
        }));

      const toScheduledCards = (
        rows: Array<{ id: string; name: string; end?: string | null; scheduled_at?: string | null }>
      ): DashboardEventCard[] =>
        (rows || []).map((e, idx) => ({
          id: String(e.id ?? '').trim() || String(e.name ?? ''),
          name: String(e.name ?? '').trim() || '—',
          endLabel: fmtDateTimeShort(e.scheduled_at),
          subLabel: `Campaign end ${fmtDateShort(e.end)}`,
          accent: idx % 3 === 0 ? 'border-amber-500' : idx % 3 === 1 ? 'border-sky-500' : 'border-fuchsia-500',
        }));

      setPublishedEvents(toPublishedCards(payload.publishedEvents ?? []));
      setScheduledEvents(toScheduledCards(payload.scheduledEvents ?? []));
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

  const eventRow = (title: string, events: DashboardEventCard[], emptyHint: string, mode: 'published' | 'scheduled') => (
    <div className="space-y-4">
      <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] px-2 flex items-center gap-2">
        <Calendar size={14} className="text-orange-500" /> {title}
      </h3>
      {events.length === 0 ? (
        <p className="px-2 text-sm font-bold text-slate-400">{emptyHint}</p>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 scroll-smooth snap-x snap-mandatory">
          {events.map((event) => (
            <Link
              key={event.id}
              href="/admin/events"
              className={`snap-start shrink-0 w-[min(100%,280px)] bg-white p-6 rounded-[35px] border-l-8 ${event.accent} border border-slate-100 shadow-sm flex items-center justify-between group hover:shadow-md transition-all`}
            >
              <div className="min-w-0 pr-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest truncate">
                  {mode === 'published' ? `End: ${event.endLabel}` : `Scheduled: ${event.endLabel}`}
                </p>
                <h4 className="text-lg font-black text-slate-900 leading-tight truncate">{event.name}</h4>
                <p className="text-[10px] font-bold text-slate-400 mt-1 truncate">{event.subLabel}</p>
              </div>
              <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-300 group-hover:text-slate-900 transition-colors shrink-0">
                <ChevronRight size={20} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20 text-slate-200">

      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Image
            src="/social-post-icon.png"
            alt="Social Post"
            width={48}
            height={48}
            className="rounded-2xl shrink-0"
            priority
          />
          <div>
            <h1 className="text-3xl font-black text-white tracking-tight">Social Post</h1>
            <p className="text-sm font-bold text-zinc-400 uppercase tracking-widest mt-3 leading-none">Live Performance Metrics</p>
          </div>
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

      <div className="space-y-10 pt-4">
        {eventRow('Published Event', publishedEvents, 'No published events in your scope.', 'published')}
        {eventRow('Scheduled Event', scheduledEvents, 'No scheduled events in your scope.', 'scheduled')}
      </div>

    </div>
  );
}
