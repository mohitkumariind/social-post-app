'use client';

import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PARTIES_DATA } from '@/lib/constants';
import type { AdminLeaderboardKpis, AdminLeaderboardRow } from '@/lib/admin/leaderboardService';
import { useDashboardAccess } from '@/lib/hooks/useDashboardAccess';
import { logDashboardUiRbac } from '@/lib/rbac/dashboard-ui-log';

type GroupOpt = { id: number; name: string };
type StateOpt = { state_id: number; state: string };

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export default function LeaderboardManagementPage() {
  const [states, setStates] = useState<StateOpt[]>([]);
  const [groups, setGroups] = useState<GroupOpt[]>([]);
  const [search, setSearch] = useState('');
  const [stateId, setStateId] = useState('');
  const [party, setParty] = useState('');
  const [groupId, setGroupId] = useState('');
  const [dateFrom, setDateFrom] = useState(() => fmtDate(addDays(new Date(), -30)));
  const [dateTo, setDateTo] = useState(() => fmtDate(new Date()));
  const [rows, setRows] = useState<AdminLeaderboardRow[]>([]);
  const [kpis, setKpis] = useState<AdminLeaderboardKpis | null>(null);
  const [totalMatching, setTotalMatching] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  const { ready: accessReady, access: dashboardAccess } = useDashboardAccess();
  const canAccessLeaderboard = dashboardAccess?.permissions.canAccessModule('leaderboard') ?? false;
  const filterVisibility = dashboardAccess?.filter_visibility ?? null;
  const canUseGlobal = filterVisibility?.canUseGlobalFilters ?? false;
  const showStatePartyFilters = filterVisibility?.showStateFilter ?? false;
  const showGroupFilter = filterVisibility?.showGroupFilter ?? false;
  const assignedStateIds = dashboardAccess?.actor.assigned_state_ids ?? [];

  useEffect(() => {
    if (!dashboardAccess) return;
    logDashboardUiRbac('leaderboard_page', {
      role: dashboardAccess.actor.role,
      allowed_modules: dashboardAccess.allowed_modules,
      hidden_modules: dashboardAccess.hidden_modules,
      filter_visibility: dashboardAccess.filter_visibility,
    });
  }, [dashboardAccess]);

  const contextLabel = useMemo(() => {
    const parts: string[] = [];
    if (party) parts.push(`Party: ${party}`);
    if (stateId) parts.push(`State id: ${stateId}`);
    if (groupId) parts.push(`Group id: ${groupId}`);
    parts.push(`Range: ${dateFrom} → ${dateTo}`);
    if (search.trim()) parts.push(`Search: “${search.trim()}”`);
    return parts.join(' · ');
  }, [party, stateId, groupId, dateFrom, dateTo, search]);

  const loadMeta = useCallback(async () => {
    const [st, gr] = await Promise.all([
      fetch('/api/admin/leaderboard?meta=states', { credentials: 'same-origin' }).then((r) =>
        r.json().catch(() => ({}))
      ),
      fetch('/api/admin/groups', { credentials: 'same-origin' }).then((r) => r.json().catch(() => ({}))),
    ]);
    const sl = Array.isArray(st?.states) ? (st.states as StateOpt[]) : [];
    setStates(sl);
    const gl = Array.isArray(gr?.groups)
      ? (gr.groups as { tag?: string; name?: string }[])
          .map((g) => ({ id: Number(g.tag), name: String(g.name ?? '') }))
          .filter((g) => Number.isFinite(g.id))
      : [];
    setGroups(gl);
  }, []);

  const fetchPage = useCallback(
    async (nextOffset: number, replace: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams();
        sp.set('date_from', new Date(`${dateFrom}T00:00:00.000Z`).toISOString());
        sp.set('date_to', new Date(`${dateTo}T23:59:59.999Z`).toISOString());
        sp.set('offset', String(nextOffset));
        sp.set('limit', String(limit));
        if (search.trim()) sp.set('search', search.trim());
        if (canUseGlobal) {
          if (stateId) sp.set('state_id', stateId);
          if (party) sp.set('party', party);
          if (groupId) sp.set('group_id', groupId);
        } else if (showGroupFilter && groupId) {
          sp.set('group_id', groupId);
        }
        if (showStatePartyFilters && stateId) sp.set('state_id', stateId);
        if (showStatePartyFilters && party) sp.set('party', party);
        const res = await fetch(`/api/admin/leaderboard?${sp.toString()}`, { credentials: 'same-origin' });
        const d = (await res.json().catch(() => ({}))) as {
          error?: string;
          rows?: AdminLeaderboardRow[];
          kpis?: AdminLeaderboardKpis;
          total_matching?: number;
        };
        if (!res.ok) throw new Error(d?.error || 'Failed to load leaderboard');
        if (replace) {
          setRows(d.rows ?? []);
          setKpis(d.kpis ?? null);
          setTotalMatching(d.total_matching ?? 0);
        } else {
          setRows((prev) => [...prev, ...(d.rows ?? [])]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load leaderboard');
        if (replace) {
          setRows([]);
          setKpis(null);
          setTotalMatching(0);
        }
      } finally {
        setLoading(false);
      }
    },
    [dateFrom, dateTo, search, stateId, party, groupId, canUseGlobal, showGroupFilter, showStatePartyFilters, limit]
  );

  useEffect(() => {
    if (!accessReady || !canAccessLeaderboard) return;
    void loadMeta();
  }, [accessReady, canAccessLeaderboard, loadMeta]);

  useEffect(() => {
    if (!accessReady || !canAccessLeaderboard) return;
    setRows([]);
    void fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load when access resolves
  }, [accessReady, canAccessLeaderboard]);

  const onApply = () => {
    setRows([]);
    void fetchPage(0, true);
  };

  const onLoadMore = () => {
    if (loading || rows.length >= totalMatching) return;
    void fetchPage(rows.length, false);
  };

  const onExport = () => {
    const sp = new URLSearchParams();
    sp.set('export', 'csv');
    sp.set('date_from', new Date(`${dateFrom}T00:00:00.000Z`).toISOString());
    sp.set('date_to', new Date(`${dateTo}T23:59:59.999Z`).toISOString());
    if (search.trim()) sp.set('search', search.trim());
    if (canUseGlobal) {
      if (stateId) sp.set('state_id', stateId);
      if (party) sp.set('party', party);
      if (groupId) sp.set('group_id', groupId);
    } else if (showGroupFilter && groupId) {
      sp.set('group_id', groupId);
    }
    if (showStatePartyFilters && stateId) sp.set('state_id', stateId);
    if (showStatePartyFilters && party) sp.set('party', party);
    window.open(`/api/admin/leaderboard?${sp.toString()}`, '_blank', 'noopener,noreferrer');
  };

  if (!accessReady) {
    return (
      <div className="text-sm text-zinc-400">
        {error ? <span className="text-red-300">{error}</span> : 'Checking access…'}
      </div>
    );
  }

  if (!canAccessLeaderboard) {
    return <div className="text-sm text-red-300">Leaderboard is not available for your role.</div>;
  }

  return (
    <div className="min-h-screen text-zinc-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Leaderboard Management</h1>
        </div>

        <div className="sticky top-0 z-10 space-y-3 border-b border-zinc-800 bg-zinc-950/95 pb-4 pt-1 backdrop-blur">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-medium text-zinc-400">
              Search (name / phone)
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                placeholder="Search…"
              />
            </label>
            {canUseGlobal ? (
              <>
                <label className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-zinc-400">
                  State
                  <select
                    value={stateId}
                    onChange={(e) => setStateId(e.target.value)}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                  >
                    <option value="">All states</option>
                    {states.map((s) => (
                      <option key={s.state_id} value={String(s.state_id)}>
                        {s.state} ({s.state_id})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-[160px] flex-col gap-1 text-xs font-medium text-zinc-400">
                  Party
                  <select
                    value={party}
                    onChange={(e) => setParty(e.target.value)}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                  >
                    <option value="">All parties</option>
                    {PARTIES_DATA.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.shortName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-zinc-400">
                  Group
                  <select
                    value={groupId}
                    onChange={(e) => setGroupId(e.target.value)}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                  >
                    <option value="">All groups</option>
                    {groups.map((g) => (
                      <option key={g.id} value={String(g.id)}>
                        {g.name} ({g.id})
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            {showStatePartyFilters && !canUseGlobal ? (
              <p className="text-xs text-zinc-500">
                Scoped to states {assignedStateIds.join(', ') || '—'}
              </p>
            ) : null}
            {showGroupFilter && !canUseGlobal ? (
              <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-zinc-400">
                Group
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
                >
                  <option value="">All assigned groups</option>
                  {groups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.name} ({g.id})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-zinc-400">
              From
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <label className="flex min-w-[140px] flex-col gap-1 text-xs font-medium text-zinc-400">
              To
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <button
              type="button"
              onClick={() => void onApply()}
              disabled={loading}
              className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => void onExport()}
              className="rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-900"
            >
              Download CSV
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            <span className="font-semibold text-zinc-400">Currently viewing:</span> {contextLabel}
          </p>
        </div>

        {error ? (
          <div className="rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {kpis ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Users in scope</div>
              <div className="mt-1 text-2xl font-semibold text-white">{kpis.total_users}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Total points</div>
              <div className="mt-1 text-2xl font-semibold text-white">{kpis.total_points}</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Top state</div>
              <div className="mt-1 text-lg font-medium text-white">{kpis.top_state_name ?? '—'}</div>
              <div className="text-xs text-zinc-500">{kpis.top_state_points} pts</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Top group</div>
              <div className="mt-1 text-lg font-medium text-white">{kpis.top_group_name ?? '—'}</div>
              <div className="text-xs text-zinc-500">{kpis.top_group_points} pts</div>
              <div className="mt-2 text-xs text-zinc-500">Avg pts / user: {kpis.avg_points_per_user}</div>
            </div>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <div className="grid grid-cols-12 gap-2 border-b border-zinc-800 bg-zinc-900/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            <div className="col-span-1">Rank</div>
            <div className="col-span-2">User</div>
            <div className="col-span-2">State</div>
            <div className="col-span-2">Party</div>
            <div className="col-span-2">Group</div>
            <div className="col-span-1 text-right">Pts</div>
            <div className="col-span-1">Last active</div>
            <div className="col-span-1 text-right">Action</div>
          </div>
          <div className="divide-y divide-zinc-800">
            {rows.map((r) => (
              <div key={`${r.profile_id}-${r.rank}`} className="grid grid-cols-12 gap-2 px-3 py-2 text-sm text-zinc-200">
                <div className="col-span-1 font-mono text-zinc-400">{r.rank}</div>
                <div className="col-span-2 truncate font-medium text-white" title={r.name}>
                  {r.name}
                </div>
                <div className="col-span-2 truncate text-zinc-300">{r.state || '—'}</div>
                <div className="col-span-2 truncate text-zinc-300">{r.party || '—'}</div>
                <div className="col-span-2 truncate text-zinc-300" title={r.group_name}>
                  {r.group_name || (r.group_id != null ? `#${r.group_id}` : '—')}
                </div>
                <div className="col-span-1 text-right font-mono text-white">{r.points}</div>
                <div className="col-span-1 text-xs text-zinc-400">
                  {r.last_active ? new Date(r.last_active).toLocaleString() : '—'}
                </div>
                <div className="col-span-1 text-right">
                  <Link
                    href={`/admin/users/${encodeURIComponent(r.profile_id)}`}
                    className="text-xs font-medium text-blue-400 hover:text-blue-300"
                  >
                    Profile
                  </Link>
                </div>
              </div>
            ))}
            {rows.length === 0 && !loading ? (
              <div className="px-3 py-8 text-center text-sm text-zinc-500">No rows for this scope.</div>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            Showing {rows.length} of {totalMatching} (page size {limit})
          </span>
          {rows.length < totalMatching ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void onLoadMore()}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-900 disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>
    </div>
  );
}
