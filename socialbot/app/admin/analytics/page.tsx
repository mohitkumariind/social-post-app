'use client';

import { Download, LineChart, Loader2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getPartyLabel } from '@/lib/constants';

type KpiBuckets = {
  today: number;
  yesterday: number;
  last7Days: number;
  last30Days: number;
  currentMonth: number;
  lastMonth: number;
  allTime: number;
};

type KpisResponse = {
  engaged_users: KpiBuckets;
  raw_downloads: KpiBuckets;
};

type StateOpt = { state_id: number; state: string };
type PartyOpt = { id: string; label: string };

type EventMetricRow = {
  event_id: string;
  title: string;
  posts: number;
  rawDownloads: number;
  engagedUsers: number;
};

const EVENTS_PAGE_SIZE = 50;

const TIME_WINDOWS: { key: keyof KpiBuckets; label: string; hint: string }[] = [
  { key: 'today', label: 'Today', hint: 'UTC calendar day' },
  { key: 'yesterday', label: 'Yesterday', hint: 'UTC calendar day' },
  { key: 'last7Days', label: 'Last 7 Days', hint: 'Rolling window' },
  { key: 'last30Days', label: 'Last 30 Days', hint: 'Rolling window' },
  { key: 'currentMonth', label: 'Current Month', hint: 'Calendar month (UTC)' },
  { key: 'lastMonth', label: 'Last Month', hint: 'Calendar month (UTC)' },
  { key: 'allTime', label: 'All Time', hint: 'Entire dataset' },
];

function num(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

function mapBuckets(tb: Partial<KpiBuckets> | undefined): KpiBuckets {
  return {
    today: Number(tb?.today ?? 0),
    yesterday: Number(tb?.yesterday ?? 0),
    last7Days: Number(tb?.last7Days ?? 0),
    last30Days: Number(tb?.last30Days ?? 0),
    currentMonth: Number(tb?.currentMonth ?? 0),
    lastMonth: Number(tb?.lastMonth ?? 0),
    allTime: Number(tb?.allTime ?? 0),
  };
}

function filterQuery(stateId: string, party: string): string {
  const sp = new URLSearchParams();
  if (stateId) sp.set('state_id', stateId);
  if (party) sp.set('party', party);
  const q = sp.toString();
  return q ? `?${q}` : '';
}

export default function AdminAnalyticsPage() {
  const [states, setStates] = useState<StateOpt[]>([]);
  const [partyOptions, setPartyOptions] = useState<PartyOpt[]>([]);
  const [stateId, setStateId] = useState('');
  const [party, setParty] = useState('');
  const [viewerRole, setViewerRole] = useState<'admin' | 'moderator' | 'campaign_manager' | null>(null);

  const [kpis, setKpis] = useState<KpisResponse | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState<string | null>(null);

  const [events, setEvents] = useState<EventMetricRow[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const showGeoFilters = viewerRole === 'admin' || viewerRole === 'moderator';
  const showPartyFilter = viewerRole === 'admin';

  const loadMeta = useCallback(async () => {
    const [vr, fl] = await Promise.all([
      fetch('/api/admin/viewer', { credentials: 'same-origin' }).then((r) => r.json().catch(() => ({}))),
      fetch('/api/admin/analytics/filters', { credentials: 'same-origin' }).then((r) => r.json().catch(() => ({}))),
    ]);
    const role = vr?.role;
    if (role === 'admin' || role === 'moderator' || role === 'campaign_manager') {
      setViewerRole(role);
    }
    setStates(Array.isArray(fl?.states) ? (fl.states as StateOpt[]) : []);
  }, []);

  const loadPartiesForState = useCallback(async (sid: string) => {
    if (!sid) {
      setPartyOptions([]);
      return;
    }
    const res = await fetch(`/api/admin/analytics/filters?state_id=${encodeURIComponent(sid)}`, {
      credentials: 'same-origin',
    });
    const d = (await res.json().catch(() => ({}))) as { parties?: PartyOpt[] };
    const list = Array.isArray(d.parties) ? d.parties : [];
    setPartyOptions(
      list.map((p) => ({
        id: p.id,
        label: getPartyLabel(p.id) || p.label,
      }))
    );
  }, []);

  const loadKpis = useCallback(async () => {
    setKpisLoading(true);
    setKpisError(null);
    try {
      const res = await fetch(`/api/admin/analytics/kpis${filterQuery(stateId, party)}`, {
        credentials: 'same-origin',
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string } & Partial<KpisResponse>;
      if (!res.ok) throw new Error(d?.error || 'Failed to load KPIs');
      setKpis({
        engaged_users: mapBuckets(d.engaged_users),
        raw_downloads: mapBuckets(d.raw_downloads),
      });
    } catch (e) {
      setKpisError(e instanceof Error ? e.message : 'Failed to load KPIs');
      setKpis(null);
    } finally {
      setKpisLoading(false);
    }
  }, [stateId, party]);

  const loadEvents = useCallback(
    async (offset: number) => {
      setEventsLoading(true);
      setEventsError(null);
      try {
        const sp = new URLSearchParams();
        if (stateId) sp.set('state_id', stateId);
        if (party) sp.set('party', party);
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
                title: String(row.title ?? 'â€”'),
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
    },
    [stateId, party]
  );

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (viewerRole === 'admin' && stateId) {
      void loadPartiesForState(stateId);
    } else {
      setPartyOptions([]);
    }
  }, [stateId, viewerRole, loadPartiesForState]);

  useEffect(() => {
    if (viewerRole == null) return;
    void loadKpis();
    void loadEvents(0);
  }, [viewerRole, stateId, party, loadKpis, loadEvents]);

  const onStateChange = (next: string) => {
    setStateId(next);
    setParty('');
  };

  const exportHref = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('kind', 'kpis');
    if (stateId) sp.set('state_id', stateId);
    if (party) sp.set('party', party);
    return `/api/admin/analytics/export?${sp}`;
  }, [stateId, party]);

  const renderKpiRow = (title: string, buckets: KpiBuckets | undefined) => (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
        {TIME_WINDOWS.map((w) => (
          <div
            key={`${title}-${w.key}`}
            className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 shadow-sm"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{w.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">
              {kpisLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
              ) : (
                num(buckets?.[w.key] ?? 0)
              )}
            </div>
            <div className="mt-0.5 text-[11px] leading-snug text-zinc-600">{w.hint}</div>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8 text-zinc-100">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
            <LineChart className="h-7 w-7 text-zinc-400" strokeWidth={1.75} />
            Analytics
          </h1>
        </div>
        <a
          href={exportHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
        >
          <Download className="h-3.5 w-3.5" />
          Export KPIs
        </a>
      </div>

      {showGeoFilters ? (
        <section className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-zinc-400">
            State
            <select
              value={stateId}
              onChange={(e) => onStateChange(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
            >
              <option value="">All states (India)</option>
              {states.map((s) => (
                <option key={s.state_id} value={String(s.state_id)}>
                  {s.state}
                </option>
              ))}
            </select>
          </label>
          {showPartyFilter ? (
            <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-zinc-400">
              Party
              <select
                value={party}
                onChange={(e) => setParty(e.target.value)}
                disabled={!stateId}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white disabled:opacity-50"
              >
                <option value="">{stateId ? 'All parties in state' : 'Select a state first'}</option>
                {partyOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </section>
      ) : null}

      {renderKpiRow('Unique engaged users', kpis?.engaged_users)}
      {kpisError ? <p className="text-sm text-red-400">{kpisError}</p> : null}

      {renderKpiRow('Raw downloads', kpis?.raw_downloads)}

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
                Showing {eventsOffset + 1}â€“{Math.min(eventsOffset + events.length, eventsTotal)} of {eventsTotal}
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

