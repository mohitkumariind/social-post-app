'use client';

import { Download, LineChart, Loader2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

type KpiBuckets = {
  today: number;
  yesterday: number;
  last7Days: number;
  last30Days: number;
  currentMonth: number;
  lastMonth: number;
  allTime: number;
};

const KPI_CARDS: { key: keyof KpiBuckets; label: string; hint: string }[] = [
  { key: 'today', label: 'Today', hint: 'Unique engaged users · UTC calendar day' },
  { key: 'yesterday', label: 'Yesterday', hint: 'Unique engaged users · UTC calendar day' },
  { key: 'last7Days', label: 'Last 7 Days', hint: 'Unique engaged users · Rolling window' },
  { key: 'last30Days', label: 'Last 30 Days', hint: 'Unique engaged users · Rolling window' },
  { key: 'currentMonth', label: 'Current Month', hint: 'Unique engaged users · Calendar month (UTC)' },
  { key: 'lastMonth', label: 'Last Month', hint: 'Unique engaged users · Calendar month (UTC)' },
  { key: 'allTime', label: 'All Time', hint: 'Unique engaged users · Entire dataset' },
];

type EventMetricRow = {
  event_id: string;
  title: string;
  posts: number;
  rawDownloads: number;
  engagedUsers: number;
};

const EVENTS_PAGE_SIZE = 50;

function num(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

export default function AdminAnalyticsPage() {
  const [kpiBuckets, setKpiBuckets] = useState<KpiBuckets | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState<string | null>(null);

  const [events, setEvents] = useState<EventMetricRow[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const loadKpis = useCallback(async () => {
    setKpisLoading(true);
    setKpisError(null);
    try {
      const res = await fetch('/api/admin/analytics/kpis', { credentials: 'same-origin' });
      const d = (await res.json().catch(() => ({}))) as { error?: string; time_buckets?: Partial<KpiBuckets> };
      if (!res.ok) throw new Error(d?.error || 'Failed to load KPIs');
      const tb = d.time_buckets ?? {};
      setKpiBuckets({
        today: Number(tb.today ?? 0),
        yesterday: Number(tb.yesterday ?? 0),
        last7Days: Number(tb.last7Days ?? 0),
        last30Days: Number(tb.last30Days ?? 0),
        currentMonth: Number(tb.currentMonth ?? 0),
        lastMonth: Number(tb.lastMonth ?? 0),
        allTime: Number(tb.allTime ?? 0),
      });
    } catch (e) {
      setKpisError(e instanceof Error ? e.message : 'Failed to load KPIs');
      setKpiBuckets(null);
    } finally {
      setKpisLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async (offset: number) => {
    setEventsLoading(true);
    setEventsError(null);
    try {
      const sp = new URLSearchParams();
      sp.set('offset', String(offset));
      sp.set('limit', String(EVENTS_PAGE_SIZE));
      const res = await fetch(`/api/admin/analytics/campaign-intelligence?${sp}`, {
        credentials: 'same-origin',
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        events?: {
          event_id?: string;
          title?: string;
          posts?: number;
          raw_downloads?: number;
          engaged_users?: number;
        }[];
        total?: number;
      };
      if (!res.ok) throw new Error(d?.error || 'Failed to load event metrics');
      setEvents(
        Array.isArray(d.events)
          ? d.events.map((row) => ({
              event_id: String(row.event_id ?? ''),
              title: String(row.title ?? '—'),
              posts: Number(row.posts ?? 0),
              rawDownloads: Number(row.raw_downloads ?? 0),
              engagedUsers: Number(row.engaged_users ?? 0),
            }))
          : []
      );
      setEventsTotal(Number(d.total ?? 0));
      setEventsOffset(offset);
    } catch (e) {
      setEventsError(e instanceof Error ? e.message : 'Failed to load event metrics');
      setEvents([]);
      setEventsTotal(0);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  useEffect(() => {
    void loadEvents(0);
  }, [loadEvents]);

  const downloadExport = async () => {
    const res = await fetch('/api/admin/analytics/export?kind=kpis', { credentials: 'same-origin' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      alert(j.error || 'Export failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'analytics-engaged-users-kpis.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 text-zinc-100">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
            <LineChart className="h-7 w-7 text-zinc-400" strokeWidth={1.75} />
            Analytics
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void downloadExport()}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
        >
          <Download className="h-3.5 w-3.5" />
          Export KPIs
        </button>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Unique engaged users
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
          {KPI_CARDS.map((k) => (
            <div
              key={k.key}
              className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 shadow-sm"
            >
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-white">
                {kpisLoading ? (
                  <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
                ) : (
                  num(kpiBuckets?.[k.key] ?? 0)
                )}
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-zinc-600">{k.hint}</div>
            </div>
          ))}
        </div>
        {kpisError ? <p className="mt-2 text-sm text-red-400">{kpisError}</p> : null}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Event metrics</h2>
            <p className="mt-0.5 text-xs text-zinc-600">Last 7 days (rolling, UTC)</p>
          </div>
          {eventsLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" /> : null}
        </div>
        {eventsError ? <div className="mb-2 text-sm text-red-400">{eventsError}</div> : null}
        <div className="overflow-x-auto overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Event name</th>
                <th className="px-3 py-2 font-medium tabular-nums">Posts</th>
                <th className="px-3 py-2 font-medium tabular-nums">Raw downloads</th>
                <th className="px-3 py-2 font-medium tabular-nums">Engaged users</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {events.map((row) => (
                <tr key={row.event_id}>
                  <td className="max-w-[320px] truncate px-3 py-2.5 text-zinc-200" title={row.title}>
                    {row.title}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-zinc-300">{num(row.posts)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-zinc-300">{num(row.rawDownloads)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-zinc-300">{num(row.engagedUsers)}</td>
                </tr>
              ))}
              {events.length === 0 && !eventsLoading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-zinc-500">
                    No events with activity in the last 7 days.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
          <span>
            {eventsTotal > 0 ? (
              <>
                Showing {eventsOffset + 1}–{Math.min(eventsOffset + events.length, eventsTotal)} of {eventsTotal}
              </>
            ) : (
              'No rows'
            )}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={eventsOffset <= 0 || eventsLoading}
              onClick={() => void loadEvents(Math.max(0, eventsOffset - EVENTS_PAGE_SIZE))}
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={eventsOffset + events.length >= eventsTotal || eventsLoading}
              onClick={() => void loadEvents(eventsOffset + EVENTS_PAGE_SIZE)}
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
