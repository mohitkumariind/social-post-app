'use client';

import { Download, LineChart, Loader2, Send } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

type KpisResponse = {
  all_time: { total_points: number };
  range: { date_from: string; date_to: string; total_points: number } | null;
  time_buckets: {
    today: number;
    yesterday: number;
    last7Days: number;
    lastMonth: number;
  };
};

type EventRow = {
  event_id: string;
  download_count: number;
  title: string;
};

type EventsPageResponse = {
  rows: EventRow[];
  pagination: { total: number; offset: number; limit: number };
};

type NotDlUser = {
  profile_id: string;
  name: string | null;
  phone: string | null;
};

type NotDlPageResponse = {
  rows: NotDlUser[];
  pagination: { total: number; offset: number; limit: number };
};

const EVENTS_PAGE_SIZE = 50;
const USERS_PAGE_SIZE = 50;

function fmtInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startEndUtcMonth(year: number, month0: number): { from: string; to: string } {
  const start = new Date(Date.UTC(year, month0, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month0 + 1, 0, 23, 59, 59, 999));
  return { from: start.toISOString(), to: end.toISOString() };
}

function num(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

export default function AdminAnalyticsPage() {
  const [kpis, setKpis] = useState<KpisResponse | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(() => fmtInputDate(new Date(Date.now() - 30 * 86400000)));
  const [dateTo, setDateTo] = useState(() => fmtInputDate(new Date()));
  const [monthPick, setMonthPick] = useState(() => String(new Date().getUTCMonth() + 1).padStart(2, '0'));
  const [yearPick, setYearPick] = useState(() => String(new Date().getUTCFullYear()));
  const [filterSearch, setFilterSearch] = useState('');

  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const [notDlByEvent, setNotDlByEvent] = useState<Record<string, number | null>>({});

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [users, setUsers] = useState<NotDlUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersOffset, setUsersOffset] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyBody, setNotifyBody] = useState('');
  const [notifySending, setNotifySending] = useState(false);
  const [notifyErr, setNotifyErr] = useState<string | null>(null);

  const loadKpis = useCallback(async () => {
    setKpisLoading(true);
    setKpisError(null);
    try {
      const sp = new URLSearchParams();
      sp.set('date_from', new Date(`${dateFrom}T00:00:00.000Z`).toISOString());
      sp.set('date_to', new Date(`${dateTo}T23:59:59.999Z`).toISOString());
      const res = await fetch(`/api/admin/analytics/kpis?${sp}`, { credentials: 'same-origin' });
      const d = (await res.json().catch(() => ({}))) as { error?: string } & Partial<KpisResponse>;
      if (!res.ok) throw new Error(d?.error || 'Failed to load KPIs');
      setKpis({
        all_time: d.all_time ?? { total_points: 0 },
        range: d.range ?? null,
        time_buckets: d.time_buckets ?? {
          today: 0,
          yesterday: 0,
          last7Days: 0,
          lastMonth: 0,
        },
      });
    } catch (e) {
      setKpisError(e instanceof Error ? e.message : 'Failed to load KPIs');
      setKpis(null);
    } finally {
      setKpisLoading(false);
    }
  }, [dateFrom, dateTo]);

  const loadEvents = useCallback(
    async (offset: number) => {
      setEventsLoading(true);
      setEventsError(null);
      try {
        const sp = new URLSearchParams();
        sp.set('offset', String(offset));
        sp.set('limit', String(EVENTS_PAGE_SIZE));
        if (filterSearch.trim()) sp.set('search', filterSearch.trim());
        const res = await fetch(`/api/admin/analytics/events?${sp}`, { credentials: 'same-origin' });
        const d = (await res.json().catch(() => ({}))) as { error?: string } & Partial<EventsPageResponse>;
        if (!res.ok) throw new Error(d?.error || 'Failed to load events');
        setEvents(Array.isArray(d.rows) ? d.rows : []);
        const p = d.pagination;
        setEventsTotal(Number(p?.total ?? 0));
        setEventsOffset(Number(p?.offset ?? offset));
      } catch (e) {
        setEventsError(e instanceof Error ? e.message : 'Failed to load events');
        setEvents([]);
        setEventsTotal(0);
      } finally {
        setEventsLoading(false);
      }
    },
    [filterSearch]
  );

  const fetchNotDlTotal = useCallback(async (eventId: string): Promise<number> => {
    const sp = new URLSearchParams();
    sp.set('event_id', eventId);
    sp.set('offset', '0');
    sp.set('limit', '1');
    const res = await fetch(`/api/admin/analytics/users/not-downloaded?${sp}`, { credentials: 'same-origin' });
    const d = (await res.json().catch(() => ({}))) as { error?: string; pagination?: { total: number } };
    if (!res.ok) return 0;
    return Number(d.pagination?.total ?? 0);
  }, []);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  useEffect(() => {
    void loadEvents(0);
  }, [loadEvents]);

  useEffect(() => {
    if (events.length === 0) {
      setNotDlByEvent({});
      return;
    }
    let cancelled = false;
    const ids = events.map((e) => e.event_id);
    setNotDlByEvent((prev) => {
      const o = { ...prev };
      for (const id of ids) o[id] = null;
      return o;
    });
    void (async () => {
      for (const r of events) {
        if (cancelled) return;
        const t = await fetchNotDlTotal(r.event_id);
        if (cancelled) return;
        setNotDlByEvent((prev) => ({ ...prev, [r.event_id]: t }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [events, fetchNotDlTotal]);

  const loadUsers = useCallback(
    async (eventId: string, offset: number) => {
      setUsersLoading(true);
      setUsersError(null);
      try {
        const sp = new URLSearchParams();
        sp.set('event_id', eventId);
        sp.set('offset', String(offset));
        sp.set('limit', String(USERS_PAGE_SIZE));
        if (filterSearch.trim()) sp.set('search', filterSearch.trim());
        const res = await fetch(`/api/admin/analytics/users/not-downloaded?${sp}`, { credentials: 'same-origin' });
        const d = (await res.json().catch(() => ({}))) as { error?: string } & Partial<NotDlPageResponse>;
        if (!res.ok) throw new Error(d?.error || 'Failed to load users');
        setUsers(Array.isArray(d.rows) ? d.rows : []);
        const p = d.pagination;
        setUsersTotal(Number(p?.total ?? 0));
        setUsersOffset(Number(p?.offset ?? offset));
      } catch (e) {
        setUsersError(e instanceof Error ? e.message : 'Failed to load users');
        setUsers([]);
        setUsersTotal(0);
      } finally {
        setUsersLoading(false);
      }
    },
    [filterSearch]
  );

  useEffect(() => {
    setSelectedIds(new Set());
    if (!selectedEventId) {
      setUsers([]);
      setUsersTotal(0);
      return;
    }
    void loadUsers(selectedEventId, 0);
  }, [selectedEventId, loadUsers]);

  const onApplyMonth = () => {
    const m = Number(monthPick);
    const y = Number(yearPick);
    if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y) || y < 2000 || y > 2100) return;
    const { from, to } = startEndUtcMonth(y, m - 1);
    setDateFrom(from.slice(0, 10));
    setDateTo(to.slice(0, 10));
  };

  const onApplyFilters = () => {
    void loadKpis();
    void loadEvents(0);
    if (selectedEventId) void loadUsers(selectedEventId, 0);
  };

  const maxDownloadsOnPage = useMemo(() => {
    if (events.length === 0) return 1;
    return Math.max(1, ...events.map((e) => e.download_count));
  }, [events]);

  const allPageSelected =
    users.length > 0 && users.every((u) => selectedIds.has(u.profile_id));
  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (const u of users) n.delete(u.profile_id);
        return n;
      });
    } else {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (const u of users) n.add(u.profile_id);
        return n;
      });
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const downloadExport = async (kind: 'kpis' | 'events' | 'not_downloaded') => {
    const sp = new URLSearchParams();
    sp.set('kind', kind);
    sp.set('date_from', new Date(`${dateFrom}T00:00:00.000Z`).toISOString());
    sp.set('date_to', new Date(`${dateTo}T23:59:59.999Z`).toISOString());
    if (filterSearch.trim()) sp.set('search', filterSearch.trim());
    if (kind === 'not_downloaded' && selectedEventId) sp.set('event_id', selectedEventId);
    const res = await fetch(`/api/admin/analytics/export?${sp}`, { credentials: 'same-origin' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      alert(j.error || 'Export failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-${kind}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sendNotification = async () => {
    if (selectedIds.size === 0) {
      setNotifyErr('Select at least one user');
      return;
    }
    const title = notifyTitle.trim();
    const body = notifyBody.trim();
    if (!title || !body) {
      setNotifyErr('Title and body are required');
      return;
    }
    setNotifySending(true);
    setNotifyErr(null);
    try {
      const res = await fetch('/api/notifications/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          all_workers: false,
          title,
          body,
          target_user_ids: Array.from(selectedIds),
          ...(selectedEventId ? { event_id: selectedEventId } : {}),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; target_user_count?: number };
      if (!res.ok) throw new Error(d?.error || 'Send failed');
      if (d.ok === false) throw new Error(d?.error || 'Send failed');
      setNotifyOpen(false);
      setNotifyTitle('');
      setNotifyBody('');
      setSelectedIds(new Set());
      if (selectedEventId) void loadUsers(selectedEventId, usersOffset);
      void loadEvents(eventsOffset);
    } catch (e) {
      setNotifyErr(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setNotifySending(false);
    }
  };

  const buckets = kpis?.time_buckets;

  return (
    <div className="mx-auto max-w-7xl space-y-8 text-zinc-100">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-white">
            <LineChart className="h-7 w-7 text-zinc-400" strokeWidth={1.75} />
            Analytics
          </h1>
          <p className="mt-1 text-sm text-zinc-500">Campaign downloads and follow-up (scoped to your access).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void downloadExport('kpis')}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
            Export KPIs
          </button>
          <button
            type="button"
            onClick={() => void downloadExport('events')}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5" />
            Export events
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Today', value: buckets?.today },
          { label: 'Yesterday', value: buckets?.yesterday },
          { label: 'Last 7 days', value: buckets?.last7Days },
          { label: 'Last month', value: buckets?.lastMonth },
        ].map((k) => (
          <div
            key={k.label}
            className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 shadow-sm"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{k.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-white">
              {kpisLoading ? <Loader2 className="h-6 w-6 animate-spin text-zinc-500" /> : num(k.value ?? 0)}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-600">Download points (UTC windows)</div>
          </div>
        ))}
      </section>

      {kpisError ? <div className="text-sm text-red-400">{kpisError}</div> : null}

      {kpis && !kpisLoading ? (
        <div className="flex flex-wrap gap-6 text-sm text-zinc-400">
          <span>
            All-time: <span className="font-medium text-zinc-200">{num(kpis.all_time.total_points)}</span> points
          </span>
          {kpis.range ? (
            <span>
              Selected range: <span className="font-medium text-zinc-200">{num(kpis.range.total_points)}</span> points
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Filter bar */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Filters</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-400">
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-400">
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
            />
          </label>
          <div className="flex flex-wrap items-end gap-2 border-l border-zinc-800 pl-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-400">
              Month
              <select
                value={monthPick}
                onChange={(e) => setMonthPick(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
              >
                {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-zinc-400">
              Year
              <input
                type="number"
                min={2000}
                max={2100}
                value={yearPick}
                onChange={(e) => setYearPick(e.target.value)}
                className="w-24 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <button
              type="button"
              onClick={onApplyMonth}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
            >
              Apply month (UTC)
            </button>
          </div>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-medium text-zinc-400">
            Search (event title / name / phone)
            <input
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
              placeholder="Filter…"
            />
          </label>
          <button
            type="button"
            onClick={onApplyFilters}
            className="rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
          >
            Apply
          </button>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-5">
        {/* Events */}
        <section className="lg:col-span-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Event performance</h2>
            {eventsLoading ? <Loader2 className="h-4 w-4 animate-spin text-zinc-500" /> : null}
          </div>
          {eventsError ? <div className="text-sm text-red-400">{eventsError}</div> : null}
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium tabular-nums">Downloads</th>
                  <th className="px-3 py-2 font-medium tabular-nums">Not DL</th>
                  <th className="min-w-[120px] px-3 py-2 font-medium">Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {events.map((row) => {
                  const notDl = notDlByEvent[row.event_id];
                  const denom = row.download_count + (typeof notDl === 'number' ? notDl : 0);
                  const pct = denom > 0 ? Math.round((row.download_count / denom) * 100) : 0;
                  const rel = Math.round((row.download_count / maxDownloadsOnPage) * 100);
                  return (
                    <tr
                      key={row.event_id}
                      className={`cursor-pointer transition-colors hover:bg-zinc-900/50 ${
                        selectedEventId === row.event_id ? 'bg-zinc-800/40 ring-1 ring-inset ring-zinc-600' : ''
                      }`}
                      onClick={() => setSelectedEventId(row.event_id)}
                    >
                      <td className="max-w-[220px] truncate px-3 py-2.5 text-zinc-200" title={row.title}>
                        {row.title}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-zinc-300">{num(row.download_count)}</td>
                      <td className="px-3 py-2.5 tabular-nums text-zinc-400">
                        {notDl === null ? '…' : num(notDl ?? 0)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-zinc-400"
                              style={{ width: `${rel}%` }}
                              title={`${pct}% reached (downloads / downloads + not downloaded)`}
                            />
                          </div>
                          <span className="w-8 text-right text-[10px] tabular-nums text-zinc-500">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {events.length === 0 && !eventsLoading ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-zinc-500">
                      No events in scope.
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

        {/* Users */}
        <section className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Not downloaded</h2>
            {usersLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" /> : null}
          </div>
          {!selectedEventId ? (
            <p className="text-sm text-zinc-500">Select an event to list users who have not downloaded its posts.</p>
          ) : (
            <>
              {usersError ? <div className="mb-2 text-sm text-red-400">{usersError}</div> : null}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={selectedIds.size === 0}
                  onClick={() => setNotifyOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  Send notification to selected ({selectedIds.size})
                </button>
                {selectedEventId ? (
                  <button
                    type="button"
                    onClick={() => void downloadExport('not_downloaded')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export list
                  </button>
                ) : null}
              </div>
              <div className="overflow-hidden rounded-lg border border-zinc-800">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="w-10 px-2 py-2">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={toggleSelectAllPage}
                          className="rounded border-zinc-600 bg-zinc-900"
                          aria-label="Select all on page"
                        />
                      </th>
                      <th className="px-2 py-2 font-medium">Name</th>
                      <th className="px-2 py-2 font-medium">Phone</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80">
                    {users.map((u) => (
                      <tr key={u.profile_id} className="hover:bg-zinc-900/40">
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(u.profile_id)}
                            onChange={() => toggleRow(u.profile_id)}
                            className="rounded border-zinc-600 bg-zinc-900"
                            aria-label={`Select ${u.name ?? u.profile_id}`}
                          />
                        </td>
                        <td className="max-w-[120px] truncate px-2 py-2 text-zinc-200">{u.name ?? '—'}</td>
                        <td className="truncate px-2 py-2 text-zinc-400">{u.phone ?? '—'}</td>
                      </tr>
                    ))}
                    {users.length === 0 && !usersLoading ? (
                      <tr>
                        <td colSpan={3} className="px-2 py-6 text-center text-zinc-500">
                          No matching users.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                <span>
                  {usersTotal > 0 ? (
                    <>
                      {usersOffset + 1}–{Math.min(usersOffset + users.length, usersTotal)} of {usersTotal}
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={usersOffset <= 0 || usersLoading}
                    onClick={() => selectedEventId && void loadUsers(selectedEventId, Math.max(0, usersOffset - USERS_PAGE_SIZE))}
                    className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={usersOffset + users.length >= usersTotal || usersLoading}
                    onClick={() =>
                      selectedEventId && void loadUsers(selectedEventId, usersOffset + USERS_PAGE_SIZE)
                    }
                    className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {notifyOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl">
            <h3 className="text-lg font-semibold text-white">Send push notification</h3>
            <p className="mt-1 text-xs text-zinc-500">{selectedIds.size} recipient(s) in scope.</p>
            <label className="mt-3 block text-xs font-medium text-zinc-400">
              Title
              <input
                value={notifyTitle}
                onChange={(e) => setNotifyTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label className="mt-2 block text-xs font-medium text-zinc-400">
              Body
              <textarea
                value={notifyBody}
                onChange={(e) => setNotifyBody(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
              />
            </label>
            {notifyErr ? <p className="mt-2 text-sm text-red-400">{notifyErr}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setNotifyOpen(false);
                  setNotifyErr(null);
                }}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={notifySending}
                onClick={() => void sendNotification()}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {notifySending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
