'use client';

import { Loader2 } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { isLikelyEventUuid } from '@/lib/captions';
import { isBroadcastSelectableEventRow } from '@/lib/broadcast-event-eligibility';

export type BroadcastMode = 'event' | 'global';

type StateRow = { id: string; name: string };

type EventRow = {
  id: string;
  eventName: string;
  stateLabel: string;
  statusLabel: 'live' | 'scheduled';
};

function eventStateIds(raw: unknown): number[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  }
  const n = Number(raw);
  return Number.isFinite(n) ? [n] : [];
}

function stateLabelFromEvent(row: Record<string, unknown>, states: StateRow[]): string {
  const ids = eventStateIds(row.state_id);
  if (ids.length === 0) return '—';
  if (ids.includes(0)) return 'All states';
  const names = ids
    .map((id) => states.find((s) => Number(s.id) === id || String(s.id) === String(id))?.name)
    .filter(Boolean) as string[];
  return names.length ? names.join(', ') : `${ids.length} state(s)`;
}

function eventDisplayName(row: Record<string, unknown>): string {
  const title = String(row.title ?? '').trim();
  const name = String(row.name ?? '').trim();
  if (title) return title;
  if (name) return name;
  return 'Untitled event';
}

function statusLabelFromRow(row: Record<string, unknown>): 'live' | 'scheduled' {
  const s = String(row.status ?? '').trim().toLowerCase();
  if (s === 'scheduled_publish') return 'scheduled';
  return 'live';
}

function mapApiRowsToEvents(rows: Record<string, unknown>[], states: StateRow[]): EventRow[] {
  return rows
    .filter((r) => isBroadcastSelectableEventRow(r))
    .map((r) => {
      const id = String(r.id ?? '').trim();
      if (!id || !isLikelyEventUuid(id)) return null;
      return {
        id,
        eventName: eventDisplayName(r),
        stateLabel: stateLabelFromEvent(r, states),
        statusLabel: statusLabelFromRow(r),
      };
    })
    .filter((x): x is EventRow => x != null);
}

export function BroadcastEventSelector({
  broadcast_mode,
  selected_event_id,
  onSelected_event_idChange,
  onEventSelectedForComposer,
  onSelectedEventDisplayNameChange,
  states,
}: {
  broadcast_mode: BroadcastMode;
  selected_event_id: string;
  onSelected_event_idChange: (id: string) => void;
  onEventSelectedForComposer?: (eventDisplayName: string) => void;
  onSelectedEventDisplayNameChange?: (displayName: string) => void;
  states: StateRow[];
}) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (broadcast_mode !== 'event') return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch('/api/admin/events?limit=200&active=1', { credentials: 'same-origin' });
        const d = (await res.json().catch(() => ({}))) as { events?: unknown; error?: string };
        if (!res.ok) {
          if (!cancelled) {
            setRows([]);
            setLoadError(d.error?.trim() || `Could not load events (HTTP ${res.status}).`);
          }
          return;
        }
        if (!Array.isArray(d.events)) {
          if (!cancelled) {
            setRows([]);
            setLoadError('Unexpected response when loading events.');
          }
          return;
        }
        const mapped = mapApiRowsToEvents(d.events as Record<string, unknown>[], states);
        if (!cancelled) setRows(mapped);
      } catch {
        if (!cancelled) {
          setRows([]);
          setLoadError('Could not load events. Check your connection and try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [broadcast_mode, states]);

  const ids = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);

  useEffect(() => {
    if (broadcast_mode !== 'event') return;
    if (loading) return;
    if (!selected_event_id) return;
    if (rows.length === 0 || !ids.has(selected_event_id)) {
      onSelected_event_idChange('');
      onSelectedEventDisplayNameChange?.('');
    }
  }, [
    broadcast_mode,
    selected_event_id,
    ids,
    loading,
    rows.length,
    onSelected_event_idChange,
    onSelectedEventDisplayNameChange,
  ]);

  useEffect(() => {
    if (broadcast_mode !== 'event' || loading) return;
    if (!selected_event_id || rows.length === 0) return;
    const ev = rows.find((r) => r.id === selected_event_id);
    if (!ev) return;
    onEventSelectedForComposer?.(ev.eventName);
    onSelectedEventDisplayNameChange?.(ev.eventName);
  }, [
    broadcast_mode,
    loading,
    selected_event_id,
    rows,
    onEventSelectedForComposer,
    onSelectedEventDisplayNameChange,
  ]);

  if (broadcast_mode !== 'event') return null;

  return (
    <div className="mt-5">
      <label className="mb-2 block text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Event (required)</label>
      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-600" aria-hidden />
          Loading active events…
        </div>
      ) : loadError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-semibold text-red-800">{loadError}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-semibold text-slate-600">
          No active events found. Publish or schedule an event first.
        </p>
      ) : (
        <div className="max-w-4xl space-y-2" role="radiogroup" aria-label="Select event for campaign">
          {rows.map((ev) => {
            const checked = selected_event_id === ev.id;
            return (
              <label
                key={ev.id}
                className={`flex cursor-pointer items-stretch gap-3 rounded-xl border px-3 py-3 transition sm:items-center sm:gap-4 sm:px-4 ${
                  checked ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500/25' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="broadcast-center-event"
                  value={ev.id}
                  checked={checked}
                  onChange={() => {
                    onSelected_event_idChange(ev.id);
                    onEventSelectedForComposer?.(ev.eventName);
                    onSelectedEventDisplayNameChange?.(ev.eventName);
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#25D366] sm:mt-0"
                />
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 text-sm sm:grid-cols-12 sm:items-center sm:gap-3">
                  <div className="font-bold text-slate-900 sm:col-span-5">
                    <span className="line-clamp-2">{ev.eventName}</span>
                  </div>
                  <div className="text-slate-600 sm:col-span-4">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 sm:hidden">State · </span>
                    <span className="line-clamp-2">{ev.stateLabel}</span>
                  </div>
                  <div className="sm:col-span-3">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 sm:hidden">Status · </span>
                    {ev.statusLabel === 'live' ? (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-emerald-800">
                        Live
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber-900">
                        Scheduled
                      </span>
                    )}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
