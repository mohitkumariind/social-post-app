'use client';

import { Download, LineChart, Loader2, Send, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';

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

type CiEventRow = {
  event_id: string;
  title: string;
  downloads: number;
  sent: number;
  delivered: number;
  opened: number;
  not_downloaded: number;
  open_rate: number | null;
};

type DrillUser = {
  user_id: string;
  name: string | null;
  phone: string | null;
  state: string;
  group: string;
  last_active: string | null;
};

const CI_PAGE_SIZE = 50;
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

function fmtOpenRatePct(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(Number(rate))) return '—';
  return `${(Number(rate) * 100).toFixed(1)}%`;
}

function fmtLastActive(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

export default function AdminAnalyticsPage() {
  const [kpis, setKpis] = useState<KpisResponse | null>(null);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(() => fmtInputDate(new Date(Date.now() - 30 * 86400000)));
  const [dateTo, setDateTo] = useState(() => fmtInputDate(new Date()));
  const [monthPick, setMonthPick] = useState(() => String(new Date().getUTCMonth() + 1).padStart(2, '0'));
  const [yearPick, setYearPick] = useState(() => String(new Date().getUTCFullYear()));
  /** Draft search in the filter bar; applied to campaign API only after Apply (avoids N+1 requests while typing). */
  const [filterSearch, setFilterSearch] = useState('');
  /** Last-applied event search sent to `/campaign-intelligence` (server-side only). */
  const [ciSearchApplied, setCiSearchApplied] = useState('');

  const [ciEvents, setCiEvents] = useState<CiEventRow[]>([]);
  const [ciTotal, setCiTotal] = useState(0);
  const [ciOffset, setCiOffset] = useState(0);
  const [ciLoading, setCiLoading] = useState(false);
  const [ciError, setCiError] = useState<string | null>(null);

  const [drillOpen, setDrillOpen] = useState(false);
  const [drillEventId, setDrillEventId] = useState<string | null>(null);
  const [drillEventTitle, setDrillEventTitle] = useState('');
  const [drillQuery, setDrillQuery] = useState('');
  const [drillQuerySent, setDrillQuerySent] = useState('');
  const [drillUsers, setDrillUsers] = useState<DrillUser[]>([]);
  const [drillTotal, setDrillTotal] = useState(0);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drillNonce, setDrillNonce] = useState(0);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState<string | null>(null);

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

  const loadCi = useCallback(
    async (offset: number) => {
      setCiLoading(true);
      setCiError(null);
      try {
        const sp = new URLSearchParams();
        sp.set('date_from', new Date(`${dateFrom}T00:00:00.000Z`).toISOString());
        sp.set('date_to', new Date(`${dateTo}T23:59:59.999Z`).toISOString());
        sp.set('offset', String(offset));
        sp.set('limit', String(CI_PAGE_SIZE));
        if (ciSearchApplied.trim()) sp.set('search', ciSearchApplied.trim());
        const res = await fetch(`/api/admin/analytics/campaign-intelligence?${sp}`, { credentials: 'same-origin' });
        const d = (await res.json().catch(() => ({}))) as {
          error?: string;
          events?: CiEventRow[];
          total?: number;
        };
        if (!res.ok) throw new Error(d?.error || 'Failed to load campaign intelligence');
        setCiEvents(Array.isArray(d.events) ? d.events : []);
        setCiTotal(Number(d.total ?? 0));
        setCiOffset(offset);
      } catch (e) {
        setCiError(e instanceof Error ? e.message : 'Failed to load campaign intelligence');
        setCiEvents([]);
        setCiTotal(0);
      } finally {
        setCiLoading(false);
      }
    },
    [dateFrom, dateTo, ciSearchApplied]
  );

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  useEffect(() => {
    void loadCi(0);
  }, [dateFrom, dateTo, ciSearchApplied, loadCi]);

  useEffect(() => {
    if (!drillOpen || !drillEventId) {
      setDrillUsers([]);
      setDrillTotal(0);
      setDrillLoading(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setDrillLoading(true);
      setDrillError(null);
      try {
        const sp = new URLSearchParams();
        sp.set('event_id', drillEventId);
        sp.set('offset', String(drillOffset));
        sp.set('limit', String(USERS_PAGE_SIZE));
        if (drillQuerySent.trim()) sp.set('search', drillQuerySent.trim());
        const res = await fetch(`/api/admin/analytics/event-users/not-downloaded?${sp}`, { credentials: 'same-origin' });
        const d = (await res.json().catch(() => ({}))) as {
          error?: string;
          users?: DrillUser[];
          total?: number;
          offset?: number;
        };
        if (cancelled) return;
        if (!res.ok) throw new Error(d?.error || 'Failed to load users');
        setDrillUsers(Array.isArray(d.users) ? d.users : []);
        setDrillTotal(Number(d.total ?? 0));
        if (d.offset != null) setDrillOffset(Number(d.offset));
      } catch (e) {
        if (!cancelled) {
          setDrillError(e instanceof Error ? e.message : 'Failed to load users');
          setDrillUsers([]);
          setDrillTotal(0);
        }
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [drillOpen, drillEventId, drillOffset, drillQuerySent, drillNonce]);

  const openDrill = (row: CiEventRow) => {
    setDrillEventId(row.event_id);
    setDrillEventTitle(row.title);
    setDrillQuery('');
    setDrillQuerySent('');
    setDrillOffset(0);
    setSelectedIds(new Set());
    setDrillError(null);
    setDrillOpen(true);
  };

  const closeDrill = () => {
    setDrillOpen(false);
    setDrillEventId(null);
    setDrillEventTitle('');
    setDrillQuery('');
    setDrillQuerySent('');
    setDrillOffset(0);
    setSelectedIds(new Set());
    setDrillUsers([]);
    setDrillTotal(0);
    setDrillError(null);
  };

  const onApplyMonth = () => {
    const m = Number(monthPick);
    const y = Number(yearPick);
    if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y) || y < 2000 || y > 2100) return;
    const { from, to } = startEndUtcMonth(y, m - 1);
    setDateFrom(from.slice(0, 10));
    setDateTo(to.slice(0, 10));
  };

  const onApplyFilters = () => {
    setCiSearchApplied(filterSearch.trim());
    void loadKpis();
  };

  const allDrillPageSelected =
    drillUsers.length > 0 && drillUsers.every((u) => selectedIds.has(u.user_id));
  const toggleSelectAllDrillPage = () => {
    if (allDrillPageSelected) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (const u of drillUsers) n.delete(u.user_id);
        return n;
      });
    } else {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (const u of drillUsers) n.add(u.user_id);
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

  const downloadExport = async (kind: 'kpis' | 'not_downloaded') => {
    const sp = new URLSearchParams();
    sp.set('kind', kind);
    sp.set('date_from', new Date(`${dateFrom}T00:00:00.000Z`).toISOString());
    sp.set('date_to', new Date(`${dateTo}T23:59:59.999Z`).toISOString());
    if (filterSearch.trim()) sp.set('search', filterSearch.trim());
    if (kind === 'not_downloaded' && drillEventId) sp.set('event_id', drillEventId);
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
          ...(drillEventId ? { event_id: drillEventId } : {}),
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean; target_user_count?: number };
      if (!res.ok) throw new Error(d?.error || 'Send failed');
      if (d.ok === false) throw new Error(d?.error || 'Send failed');
      setNotifyOpen(false);
      setNotifyTitle('');
      setNotifyBody('');
      setSelectedIds(new Set());
      void loadCi(ciOffset);
      if (drillOpen && drillEventId) setDrillNonce((n) => n + 1);
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
            Search events (title / name)
            <input
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
              placeholder="Applied to campaign table on Apply…"
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

      {/* Campaign Intelligence */}
      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Campaign Intelligence</h2>
          </div>
          {ciLoading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-500" /> : null}
        </div>
        {ciError ? <div className="mb-2 text-sm text-red-400">{ciError}</div> : null}
        <div className="overflow-x-auto overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-900/80 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium tabular-nums">Downloads</th>
                <th className="px-3 py-2 font-medium tabular-nums">Sent</th>
                <th className="px-3 py-2 font-medium tabular-nums">Delivered</th>
                <th className="px-3 py-2 font-medium tabular-nums">Opened</th>
                <th className="px-3 py-2 font-medium tabular-nums">Not DL</th>
                <th className="px-3 py-2 font-medium tabular-nums">Open rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/80">
              {ciEvents.map((row) => (
                <tr
                  key={row.event_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDrill(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openDrill(row);
                    }
                  }}
                  className="cursor-pointer transition-colors hover:bg-zinc-900/50"
                >
                  <td className="max-w-[220px] truncate px-3 py-2.5 text-zinc-200" title={row.title}>
                    {row.title}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-zinc-300">{num(row.downloads)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-zinc-300">{num(row.sent)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-zinc-300">{num(row.delivered)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-zinc-300">{num(row.opened)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-zinc-400">{num(row.not_downloaded)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-zinc-400">{fmtOpenRatePct(row.open_rate)}</td>
                </tr>
              ))}
              {ciEvents.length === 0 && !ciLoading ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">
                    No events in scope.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
          <span>
            {ciTotal > 0 ? (
              <>
                Showing {ciOffset + 1}–{Math.min(ciOffset + ciEvents.length, ciTotal)} of {ciTotal}
              </>
            ) : (
              'No rows'
            )}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={ciOffset <= 0 || ciLoading}
              onClick={() => void loadCi(Math.max(0, ciOffset - CI_PAGE_SIZE))}
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={ciOffset + ciEvents.length >= ciTotal || ciLoading}
              onClick={() => void loadCi(ciOffset + CI_PAGE_SIZE)}
              className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {/* Drilldown: not downloaded users */}
      {drillOpen && drillEventId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drill-title"
          >
            <div className="flex shrink-0 items-start justify-between gap-2 border-b border-zinc-800 p-4">
              <div className="min-w-0">
                <h3 id="drill-title" className="text-lg font-semibold text-white">
                  Not downloaded
                </h3>
                <p className="mt-0.5 truncate text-sm text-zinc-400" title={drillEventTitle}>
                  {drillEventTitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => closeDrill()}
                className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="shrink-0 space-y-2 border-b border-zinc-800 p-4">
              {drillError ? <div className="text-sm text-red-400">{drillError}</div> : null}
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs font-medium text-zinc-400">
                  Search users (server-side)
                  <input
                    value={drillQuery}
                    onChange={(e) => setDrillQuery(e.target.value)}
                    className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
                    placeholder="Name / id…"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setDrillOffset(0);
                    setDrillQuerySent(drillQuery.trim());
                  }}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700"
                >
                  Apply search
                </button>
                <button
                  type="button"
                  disabled={selectedIds.size === 0}
                  onClick={() => setNotifyOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  Notify selected ({selectedIds.size})
                </button>
                <button
                  type="button"
                  onClick={() => void downloadExport('not_downloaded')}
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4 pt-0">
              {drillLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 border-b border-zinc-800 bg-zinc-900/95 text-xs uppercase text-zinc-500">
                    <tr>
                      <th className="w-10 py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={allDrillPageSelected}
                          onChange={toggleSelectAllDrillPage}
                          className="rounded border-zinc-600 bg-zinc-900"
                          aria-label="Select all on page"
                        />
                      </th>
                      <th className="py-2 pr-2 font-medium">Name</th>
                      <th className="py-2 pr-2 font-medium">Phone</th>
                      <th className="py-2 pr-2 font-medium">State</th>
                      <th className="py-2 pr-2 font-medium">Group</th>
                      <th className="py-2 font-medium">Last active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/80">
                    {drillUsers.map((u) => (
                      <tr key={u.user_id} className="hover:bg-zinc-900/40">
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(u.user_id)}
                            onChange={() => toggleRow(u.user_id)}
                            className="rounded border-zinc-600 bg-zinc-900"
                            aria-label={`Select ${u.name ?? u.user_id}`}
                          />
                        </td>
                        <td className="max-w-[140px] truncate py-2 pr-2 text-zinc-200">{u.name ?? '—'}</td>
                        <td className="max-w-[120px] truncate py-2 pr-2 text-zinc-400">{u.phone ?? '—'}</td>
                        <td className="max-w-[100px] truncate py-2 pr-2 text-zinc-400">{u.state || '—'}</td>
                        <td className="max-w-[120px] truncate py-2 pr-2 text-zinc-400">{u.group || '—'}</td>
                        <td className="whitespace-nowrap py-2 text-zinc-500">{fmtLastActive(u.last_active)}</td>
                      </tr>
                    ))}
                    {drillUsers.length === 0 && !drillLoading ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-zinc-500">
                          No matching users.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-zinc-800 p-4 text-xs text-zinc-500">
              <span>
                {drillTotal > 0 ? (
                  <>
                    {drillOffset + 1}–{Math.min(drillOffset + drillUsers.length, drillTotal)} of {drillTotal}
                  </>
                ) : (
                  '—'
                )}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={drillOffset <= 0 || drillLoading}
                  onClick={() => setDrillOffset(Math.max(0, drillOffset - USERS_PAGE_SIZE))}
                  className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={drillOffset + drillUsers.length >= drillTotal || drillLoading}
                  onClick={() => setDrillOffset(drillOffset + USERS_PAGE_SIZE)}
                  className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {notifyOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
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
