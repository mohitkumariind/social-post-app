'use client';

import React, { useEffect, useMemo, useState } from 'react';

type ObsRow = {
  id: string;
  created_at: string;
  user_id: string | null;
  role: string;
  event_type: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  result: 'allowed' | 'denied';
  severity: 'info' | 'warning' | 'critical';
  scope_state_ids: number[];
  scope_group_ids: string[];
  metadata: Record<string, unknown>;
};

type Overview = {
  since: string;
  allowed: number;
  denied: number;
  by_role: Record<string, { allowed: number; denied: number; critical: number; warning: number }>;
};

export default function RbacObservabilityClient() {
  const [events, setEvents] = useState<ObsRow[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string>('');

  const [role, setRole] = useState('');
  const [severity, setSeverity] = useState('');
  const [eventType, setEventType] = useState('');
  const [result, setResult] = useState('');

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set('limit', '50');
    if (cursor) sp.set('cursor_created_at', cursor);
    if (role) sp.set('role', role);
    if (severity) sp.set('severity', severity);
    if (eventType) sp.set('event_type', eventType);
    if (result) sp.set('result', result);
    return sp.toString();
  }, [cursor, role, severity, eventType, result]);

  const load = async (first: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/rbac-observability?${qs}`, { credentials: 'same-origin' });
      const d = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`);
      if (d?.schemaMissing) {
        setEvents([]);
        setOverview(null);
        setCursor('');
        setError('RBAC observability table is not deployed yet.');
        return;
      }
      const rows = Array.isArray(d.events) ? (d.events as ObsRow[]) : [];
      setEvents((prev) => (first ? rows : [...prev, ...rows]));
      setCursor(typeof d.next_cursor_created_at === 'string' ? d.next_cursor_created_at : '');
      setOverview(d.overview ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setCursor('');
    void (async () => {
      await load(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, severity, eventType, result]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">RBAC Observability</h1>
            <p className="mt-1 text-sm text-zinc-400">Security intelligence on allowed/denied RBAC actions.</p>
          </div>
          <button
            onClick={() => {
              setCursor('');
              void load(true);
            }}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        {overview ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Last 24h Allowed</div>
              <div className="mt-1 text-2xl font-bold">{overview.allowed}</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Last 24h Denied</div>
              <div className="mt-1 text-2xl font-bold">{overview.denied}</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Since</div>
              <div className="mt-1 text-sm font-medium text-zinc-200">{new Date(overview.since).toLocaleString()}</div>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
              <option value="">All roles</option>
              <option value="admin">admin</option>
              <option value="moderator">moderator</option>
              <option value="campaign_manager">campaign_manager</option>
              <option value="system">system</option>
            </select>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
              <option value="">All severity</option>
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>
            <select value={eventType} onChange={(e) => setEventType(e.target.value)} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
              <option value="">All event types</option>
              <option value="read">read</option>
              <option value="mutation">mutation</option>
              <option value="undo">undo</option>
              <option value="anomaly">anomaly</option>
            </select>
            <select value={result} onChange={(e) => setResult(e.target.value)} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
              <option value="">All results</option>
              <option value="allowed">allowed</option>
              <option value="denied">denied</option>
            </select>
          </div>
        </div>

        {error ? <div className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</div> : null}

        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <div className="grid grid-cols-12 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            <div className="col-span-2">Time</div>
            <div className="col-span-2">User</div>
            <div className="col-span-2">Role</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-2">Action</div>
            <div className="col-span-2 text-right">Result</div>
          </div>
          <div className="divide-y divide-zinc-800">
            {events.map((r) => (
              <div key={r.id} className="grid grid-cols-12 px-4 py-3 text-sm text-zinc-200">
                <div className="col-span-2 text-zinc-400">{new Date(r.created_at).toLocaleString()}</div>
                <div className="col-span-2 truncate">{r.user_id ?? '-'}</div>
                <div className="col-span-2">{r.role}</div>
                <div className="col-span-2">{r.event_type}</div>
                <div className="col-span-2 truncate">{r.action}</div>
                <div className="col-span-2 text-right">
                  <span
                    className={`rounded px-2 py-1 text-xs ${
                      r.result === 'denied'
                        ? r.severity === 'critical'
                          ? 'bg-red-900/50 text-red-200'
                          : 'bg-amber-900/40 text-amber-200'
                        : 'bg-emerald-900/30 text-emerald-200'
                    }`}
                  >
                    {r.result} · {r.severity}
                  </span>
                </div>
              </div>
            ))}
            {events.length === 0 && !loading ? <div className="px-4 py-10 text-center text-sm text-zinc-500">No events found.</div> : null}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-500">{loading ? 'Loading…' : `${events.length} rows`}</div>
          <button
            disabled={loading || !cursor}
            onClick={() => void load(false)}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Load more
          </button>
        </div>
      </div>
    </div>
  );
}

