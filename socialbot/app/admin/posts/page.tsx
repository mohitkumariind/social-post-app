"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useDashboardAccess } from '@/lib/hooks/useDashboardAccess';

type AdminPostRow = {
  id: string | number;
  title?: string | null;
  image_url?: string | null;
  category?: string | null;
  created_at?: string | null;
  status?: string | null;
  deleted_at?: string | null;
  scheduled_at?: string | null;
  download_count?: number | null;
};

export default function AdminPostsPage() {
  const { access } = useDashboardAccess();
  const canManagePosts = access?.permissions.canAccessModule('events') ?? false;

  const [rows, setRows] = useState<AdminPostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scheduleModal, setScheduleModal] = useState<{ open: boolean; row: AdminPostRow | null }>({ open: false, row: null });
  const [scheduleValue, setScheduleValue] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/posts', { credentials: 'same-origin' });
      const d = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(d?.error || 'Failed to load posts');
      setRows(Array.isArray(d.posts) ? d.posts : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load posts');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const fmt = (v: unknown) => {
    const s = String(v ?? '').trim();
    return s || '-';
  };

  const visibleRows = useMemo(() => rows, [rows]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Posts</h1>
          <button
            onClick={() => void load()}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700"
          >
            Refresh
          </button>
        </div>

        {error ? <div className="mb-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</div> : null}

        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <div className="grid grid-cols-12 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            <div className="col-span-3">Title</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Downloads</div>
            <div className="col-span-2">Scheduled</div>
            <div className="col-span-2">Created</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>
          <div className="divide-y divide-zinc-800">
            {loading ? (
              <div className="px-4 py-10 text-center text-sm text-zinc-500">Loading…</div>
            ) : visibleRows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-zinc-500">No posts found.</div>
            ) : (
              visibleRows.map((r) => (
                <div key={String(r.id)} className="grid grid-cols-12 items-center px-4 py-3 text-sm text-zinc-200">
                  <div className="col-span-3 truncate">{fmt(r.title)}</div>
                  <div className="col-span-2">{fmt(r.status ?? 'published')}</div>
                  <div className="col-span-2 tabular-nums">{Number(r.download_count ?? 0)}</div>
                  <div className="col-span-2">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString() : '-'}</div>
                  <div className="col-span-2 text-zinc-400">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}</div>
                  <div className="col-span-1 flex justify-end">
                    {canManagePosts ? (
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleModal({ open: true, row: r });
                        setScheduleValue('');
                      }}
                      className="rounded bg-zinc-800 px-2 py-1 text-xs text-white hover:bg-zinc-700"
                    >
                      Schedule
                    </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {scheduleModal.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-white">
            <div className="mb-3 text-lg font-semibold">Schedule post</div>
            <div className="text-sm text-zinc-300 mb-4 truncate">
              {fmt(scheduleModal.row?.title)}
            </div>

            <label className="block text-xs font-semibold text-zinc-400 mb-1">Scheduled time</label>
            <input
              type="datetime-local"
              value={scheduleValue}
              onChange={(e) => setScheduleValue(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                disabled={saving}
                onClick={() => setScheduleModal({ open: false, row: null })}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                disabled={saving || !scheduleModal.row}
                onClick={async () => {
                  const row = scheduleModal.row;
                  if (!row) return;
                  if (!scheduleValue) {
                    setError('Please pick a future date/time');
                    return;
                  }
                  const iso = new Date(scheduleValue).toISOString();
                  if (iso <= new Date().toISOString()) {
                    setError('scheduled_at must be in the future');
                    return;
                  }

                  setSaving(true);
                  setError(null);
                  try {
                    const res = await fetch('/api/admin/posts', {
                      method: 'PATCH',
                      credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: String(row.id), patch: { scheduled_at: iso } }),
                    });
                    const d = (await res.json().catch(() => ({}))) as any;
                    if (!res.ok) throw new Error(d?.error || 'Failed to schedule');
                    await load();
                    setScheduleModal({ open: false, row: null });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to schedule');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save schedule'}
              </button>
              <button
                disabled={saving || !scheduleModal.row}
                onClick={async () => {
                  const row = scheduleModal.row;
                  if (!row) return;
                  setSaving(true);
                  setError(null);
                  try {
                    const res = await fetch('/api/admin/posts', {
                      method: 'PATCH',
                      credentials: 'same-origin',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ id: String(row.id), patch: { scheduled_at: null } }),
                    });
                    const d = (await res.json().catch(() => ({}))) as any;
                    if (!res.ok) throw new Error(d?.error || 'Failed to publish now');
                    await load();
                    setScheduleModal({ open: false, row: null });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Failed to publish now');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Publish now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
