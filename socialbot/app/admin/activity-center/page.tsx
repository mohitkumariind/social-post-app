'use client';

import React, { useEffect, useMemo, useState } from 'react';

type AdminLogRow = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_role: string;
  action_type: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  severity: string;
  undoable: boolean;
  undone_at: string | null;
};

const TABS: { id: string; label: string; resource_type?: string; severity?: string }[] = [
  { id: 'all', label: 'All Activity' },
  { id: 'events', label: 'Events', resource_type: 'events' },
  { id: 'notifications', label: 'Notifications', resource_type: 'notifications' },
  { id: 'groups', label: 'Groups', resource_type: 'groups' },
  { id: 'undo', label: 'Undo History' },
  { id: 'jobs', label: 'Scheduled Jobs', resource_type: 'scheduled_notifications' },
  { id: 'failures', label: 'Failures', severity: 'critical' },
];

export default function ActivityCenterPage() {
  const [tab, setTab] = useState('all');
  const [logs, setLogs] = useState<AdminLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string>('');
  const [q, setQ] = useState('');
  const [undoModal, setUndoModal] = useState<{ open: boolean; row: AdminLogRow | null; busy: boolean; err: string | null }>({
    open: false,
    row: null,
    busy: false,
    err: null,
  });

  const tabSpec = useMemo(() => TABS.find((t) => t.id === tab) ?? TABS[0], [tab]);

  async function load(firstPage: boolean) {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set('limit', '50');
      if (!firstPage && cursor) sp.set('cursor_created_at', cursor);
      if (tabSpec.resource_type) sp.set('resource_type', tabSpec.resource_type);
      if (tabSpec.severity) sp.set('severity', tabSpec.severity);
      if (q.trim()) sp.set('q', q.trim());
      const res = await fetch(`/api/admin/activity?${sp.toString()}`, { credentials: 'same-origin' });
      const d = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(d?.error || 'Failed to load activity');
      const next = Array.isArray(d.logs) ? (d.logs as AdminLogRow[]) : [];
      const nextCursor = typeof d.next_cursor_created_at === 'string' ? d.next_cursor_created_at : '';
      setCursor(nextCursor);
      setLogs((prev) => (firstPage ? next : [...prev, ...next]));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCursor('');
    setLogs([]);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold tracking-tight">Activity Center</h1>
            <div className="flex items-center gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search resource name or actor user id"
                className="w-[320px] rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500"
              />
              <button
                onClick={() => {
                  setCursor('');
                  setLogs([]);
                  void load(true);
                }}
                className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
              >
                Search
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-full border px-4 py-1.5 text-sm ${
                  tab === t.id ? 'border-zinc-700 bg-zinc-800 text-white' : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800/50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {error ? <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</div> : null}

        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <div className="grid grid-cols-12 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            <div className="col-span-2">Time</div>
            <div className="col-span-2">Actor</div>
            <div className="col-span-2">Action</div>
            <div className="col-span-2">Resource</div>
            <div className="col-span-3">Name</div>
            <div className="col-span-1 text-right">Undo</div>
          </div>
          <div className="divide-y divide-zinc-800">
            {logs.map((r) => (
              <div key={r.id} className="grid grid-cols-12 px-4 py-3 text-sm text-zinc-200">
                <div className="col-span-2 text-zinc-400">{new Date(r.created_at).toLocaleString()}</div>
                <div className="col-span-2">
                  <div className="text-white">{r.actor_role}</div>
                  <div className="truncate text-xs text-zinc-500">{r.actor_user_id ?? '-'}</div>
                </div>
                <div className="col-span-2">{r.action_type}</div>
                <div className="col-span-2">
                  <div className="text-white">{r.resource_type}</div>
                  <div className="truncate text-xs text-zinc-500">{r.resource_id ?? '-'}</div>
                </div>
                <div className="col-span-3 truncate">{r.resource_name ?? '-'}</div>
                <div className="col-span-1 text-right text-xs">
                  {r.undoable ? (
                    r.undone_at ? (
                      <span className="text-zinc-500">Already Undone</span>
                    ) : (
                      <button
                        onClick={() => setUndoModal({ open: true, row: r, busy: false, err: null })}
                        className="rounded bg-zinc-800 px-2 py-1 text-xs text-white hover:bg-zinc-700"
                      >
                        Undo Available
                      </button>
                    )
                  ) : (
                    '-'
                  )}
                </div>
              </div>
            ))}
            {logs.length === 0 && !loading ? <div className="px-4 py-10 text-center text-sm text-zinc-500">No activity found.</div> : null}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-zinc-500">{loading ? 'Loading…' : `${logs.length} rows`}</div>
          <button
            disabled={loading || !cursor}
            onClick={() => void load(false)}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Load more
          </button>
        </div>
      </div>

      {undoModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-white">
            <div className="mb-3 text-lg font-semibold">Confirm undo</div>
            <div className="space-y-2 text-sm text-zinc-300">
              <div>
                <span className="text-zinc-500">Action:</span> {undoModal.row?.action_type}
              </div>
              <div>
                <span className="text-zinc-500">Resource:</span> {undoModal.row?.resource_type} {undoModal.row?.resource_id ?? ''}
              </div>
              <div>
                <span className="text-zinc-500">Name:</span> {undoModal.row?.resource_name ?? '-'}
              </div>
            </div>
            {undoModal.err ? <div className="mt-3 rounded-lg border border-red-900 bg-red-950/40 p-2 text-sm text-red-200">{undoModal.err}</div> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                disabled={undoModal.busy}
                onClick={() => setUndoModal({ open: false, row: null, busy: false, err: null })}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={undoModal.busy || !undoModal.row || !!undoModal.row.undone_at}
                onClick={async () => {
                  const row = undoModal.row;
                  if (!row) return;
                  setUndoModal((p) => ({ ...p, busy: true, err: null }));
                  try {
                    const res = await fetch(`/api/admin/activity/undo/${encodeURIComponent(row.id)}`, {
                      method: 'POST',
                      credentials: 'same-origin',
                    });
                    const d = (await res.json().catch(() => ({}))) as any;
                    if (!res.ok) throw new Error(d?.error || 'Undo failed');
                    // Update row state locally to disable double-undo.
                    setLogs((prev) => prev.map((x) => (x.id === row.id ? { ...x, undone_at: new Date().toISOString() } : x)));
                    setUndoModal({ open: false, row: null, busy: false, err: null });
                  } catch (e) {
                    setUndoModal((p) => ({ ...p, busy: false, err: e instanceof Error ? e.message : 'Undo failed' }));
                  }
                }}
                className="rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {undoModal.busy ? 'Undoing…' : 'Undo'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

